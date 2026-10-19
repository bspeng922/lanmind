//! Pure JavaScript interpreter in a disposable process. No host FS, network, shell or module APIs.
use crate::ai_types::*;
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

fn evaluate(script: &str, input: &Value) -> AiResult<Value> {
    if script.len() > 64_000 || input.to_string().len() > 1_000_000 {
        return Err(AiError::new("SCRIPT_LIMIT", "脚本或输入过长"));
    }
    let mut context = boa_engine::Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(1_000_000);
    context.runtime_limits_mut().set_recursion_limit(64);
    context.runtime_limits_mut().set_stack_size_limit(512);
    let source =
        format!("JSON.stringify((function(input) {{ 'use strict';\n{script}\n}})({input}))");
    let result = context
        .eval(boa_engine::Source::from_bytes(&source))
        .map_err(|_| AiError::new("SCRIPT_ERROR", "脚本执行失败或超过循环、递归限制"))?;
    let output = result
        .as_string()
        .ok_or_else(|| AiError::new("SCRIPT_ERROR", "脚本必须 return 一个 JSON 值"))?
        .to_std_string_escaped();
    if output.len() > 1_000_000 {
        return Err(AiError::new("SCRIPT_LIMIT", "脚本输出超过 1 MB"));
    }
    serde_json::from_str(&output).map_err(Into::into)
}
pub fn try_worker() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--lanmind-ai-script-worker") {
        return false;
    }
    #[cfg(unix)]
    unsafe {
        let memory = libc::rlimit {
            rlim_cur: 512 * 1024 * 1024,
            rlim_max: 512 * 1024 * 1024,
        };
        libc::setrlimit(libc::RLIMIT_AS, &memory);
        let cpu = libc::rlimit {
            rlim_cur: 5,
            rlim_max: 5,
        };
        libc::setrlimit(libc::RLIMIT_CPU, &cpu);
    }
    use std::io::{Read, Write};
    let mut raw = Vec::new();
    let result = (|| -> AiResult<Value> {
        std::io::stdin().take(1_100_001).read_to_end(&mut raw)?;
        if raw.len() > 1_100_000 {
            return Err(AiError::new("SCRIPT_LIMIT", "输入过长"));
        }
        let value: Value = serde_json::from_slice(&raw)?;
        evaluate(value["script"].as_str().ok_or("缺少脚本")?, &value["input"])
    })();
    let response = match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    };
    let _ = std::io::stdout().write_all(response.to_string().as_bytes());
    true
}

#[cfg(windows)]
struct Job(usize);
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
#[cfg(windows)]
fn constrain(child: &tokio::process::Child) -> AiResult<Job> {
    use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(AiError::new("SANDBOX_UNAVAILABLE", "无法建立脚本资源边界"));
        }
        let mut limit: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_PROCESS_TIME;
        limit.ProcessMemoryLimit = 256 * 1024 * 1024;
        limit.BasicLimitInformation.PerProcessUserTimeLimit = 50_000_000;
        let process = child.raw_handle().ok_or("脚本进程不可用")?;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limit as *const _ as _,
            std::mem::size_of_val(&limit) as u32,
        ) == 0
            || AssignProcessToJobObject(job, process as _) == 0
        {
            CloseHandle(job);
            return Err(AiError::new(
                "SANDBOX_UNAVAILABLE",
                "无法限制脚本资源，执行已拒绝",
            ));
        }
        Ok(Job(job as usize))
    }
}
pub async fn run(script: &str, input: &Value, cancel: &CancellationToken) -> AiResult<Value> {
    run_with_executable(&std::env::current_exe()?, script, input, cancel).await
}
async fn run_with_executable(
    exe: &std::path::Path,
    script: &str,
    input: &Value,
    cancel: &CancellationToken,
) -> AiResult<Value> {
    if cancel.is_cancelled() {
        return Err(AiError::new("CANCELLED", "脚本已停止"));
    }
    if script.len() > 64_000 || input.to_string().len() > 1_000_000 {
        return Err(AiError::new("SCRIPT_LIMIT", "脚本或输入过长"));
    }
    let mut command = Command::new(exe);
    command
        .arg("--lanmind-ai-script-worker")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let _job = constrain(&child)?;
    let mut stdin = child.stdin.take().ok_or("脚本输入不可用")?;
    stdin
        .write_all(
            json!({"script":script,"input":input})
                .to_string()
                .as_bytes(),
        )
        .await?;
    drop(stdin);
    let stdout = child.stdout.take().ok_or("脚本输出不可用")?;
    let task = async {
        let mut bytes = Vec::new();
        stdout.take(1_100_001).read_to_end(&mut bytes).await?;
        if bytes.len() > 1_100_000 {
            return Err(AiError::new("SCRIPT_LIMIT", "脚本输出过长"));
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(AiError::new("SCRIPT_LIMIT", "脚本超出资源限制或进程退出"));
        }
        let result: Value = serde_json::from_slice(&bytes)?;
        if result["ok"] == true {
            Ok(result["value"].clone())
        } else {
            Err(serde_json::from_value::<AiError>(result["error"].clone())?)
        }
    };
    tokio::select! {biased;_=cancel.cancelled()=>Err(AiError::new("CANCELLED","脚本已停止")),result=tokio::time::timeout(std::time::Duration::from_secs(10),task)=>result.map_err(|_|AiError::new("SCRIPT_LIMIT","脚本超过 10 秒，已终止"))?}
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scripts_have_only_json_and_ecmascript() {
        assert_eq!(
            evaluate("return input.map(x=>x*2)", &json!([1, 2])).unwrap(),
            json!([2, 4])
        );
        assert_eq!(
            evaluate(
                "return [typeof process, typeof require, typeof fetch]",
                &Value::Null
            )
            .unwrap(),
            json!(["undefined", "undefined", "undefined"])
        );
        assert!(evaluate("while(true) {}", &Value::Null).is_err());
    }
    #[tokio::test]
    #[ignore = "requires a freshly built desktop binary in LANMIND_AI_TEST_BINARY"]
    async fn native_worker_obeys_process_boundary_and_cancellation() {
        let exe = std::path::PathBuf::from(
            std::env::var("LANMIND_AI_TEST_BINARY").expect("set LANMIND_AI_TEST_BINARY"),
        );
        let cancel = CancellationToken::new();
        assert_eq!(run_with_executable(&exe, "return {result:input.reduce((a,b)=>a+b,0),host:[typeof process,typeof require,typeof fetch]}", &json!([1,2,3]), &cancel).await.unwrap(),json!({"result":6,"host":["undefined","undefined","undefined"]}));
        assert!(
            run_with_executable(&exe, "while(true) {}", &Value::Null, &cancel)
                .await
                .is_err()
        );
        let pending = CancellationToken::new();
        let copy = pending.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            copy.cancel();
        });
        let started = std::time::Instant::now();
        let result = run_with_executable(
            &exe,
            "return 'x'.repeat(100000000).split('').sort().join('')",
            &Value::Null,
            &pending,
        )
        .await;
        assert_eq!(result.unwrap_err().code, "CANCELLED");
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
    }
}
