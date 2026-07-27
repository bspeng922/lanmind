//! One transparent calendar window. Tauri owns the native styles and move/resize
//! loop for its whole lifetime; locking only changes z-order. Reparenting the
//! WebView2 host into Explorer's WorkerW breaks DWM composition and leaves
//! stale black/captioned surfaces on the desktop.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCalendarConfig {
    pub enabled: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub opacity: Option<u32>,
    pub show_completed: Option<bool>,
    pub theme_tone: Option<String>,
    pub custom_color: Option<String>,
}


static CONFIG_LOCK: Mutex<()> = Mutex::new(());
static ACTIVE: AtomicBool = AtomicBool::new(false);
static ADJUST_MODE: AtomicBool = AtomicBool::new(false);
static INTERACTIVE_MODE: AtomicBool = AtomicBool::new(false);
static BOUNDS_REVISION: AtomicU64 = AtomicU64::new(0);
const MIN_WIDTH: u32 = 520;
const MIN_HEIGHT: u32 = 420;

fn is_valid_window_size(width: u32, height: u32) -> bool {
    width >= MIN_WIDTH && height >= MIN_HEIGHT
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("desktop-calendar.json"))
}

pub fn load_config(app: &AppHandle) -> DesktopCalendarConfig {
    let _guard = CONFIG_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &DesktopCalendarConfig) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let path = config_path(app).ok_or("无法找到桌面日历配置目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

// Serialize transitions and config updates on the window's own thread.
// Callers await the result without holding locks or blocking the UI thread.
async fn with_window<T: Send + 'static>(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle, &WebviewWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let calendar_app = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = calendar_app
            .get_webview_window("desktop-calendar")
            .ok_or_else(|| "桌面日历窗口未就绪".to_string())
            .and_then(|window| action(&calendar_app, &window));
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Acquire)
}

pub fn is_adjust_mode() -> bool {
    ADJUST_MODE.load(Ordering::Acquire)
}

fn capture_bounds(
    window: &WebviewWindow,
    config: &mut DesktopCalendarConfig,
) -> Result<(), String> {
    if window.is_minimized().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let size = window.outer_size().map_err(|e| e.to_string())?;
    if is_valid_window_size(size.width, size.height) {
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        config.x = Some(pos.x);
        config.y = Some(pos.y);
        config.width = Some(size.width);
        config.height = Some(size.height);
    }
    Ok(())
}

fn restore_bounds(window: &WebviewWindow, config: &DesktopCalendarConfig) -> Result<(), String> {
    if let (Some(width), Some(height)) = (config.width, config.height) {
        if is_valid_window_size(width, height) {
            window
                .set_size(PhysicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
        }
    }
    if let (Some(x), Some(y)) = (config.x, config.y) {
        // Keep the header reachable after a display is removed or rearranged.
        let visible = window
            .available_monitors()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|monitor| {
                let pos = monitor.position();
                let size = monitor.size();
                i64::from(x) >= i64::from(pos.x)
                    && i64::from(x) + 100 < i64::from(pos.x) + i64::from(size.width)
                    && i64::from(y) >= i64::from(pos.y)
                    && i64::from(y) + 48 < i64::from(pos.y) + i64::from(size.height)
            });
        if visible {
            return window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string());
        }
    }
    if let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? {
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let pos = monitor.position();
        window
            .set_position(PhysicalPosition::new(
                pos.x + (monitor.size().width as i32 - size.width as i32 - 24).max(0),
                pos.y + 40,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_desktop_owner(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetShellWindow, GetWindow, SetWindowLongPtrW, SetWindowPos, GWLP_HWNDPARENT, GW_OWNER,
        HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
    unsafe {
        let shell = GetShellWindow();
        if !shell.is_null() {
            // Ownership keeps this top-level window above the desktop when
            // Win+D raises the shell. This is NOT SetParent: WS_CHILD and the
            // WebView2/DWM composition tree remain untouched in every mode.
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, shell as isize);
            if GetWindow(hwnd, GW_OWNER) != shell {
                return Err("无法设置桌面日历窗口归属".into());
            }
            // Apply the owner and z-order after ShowWindow has made the host
            // visible. Doing this while hidden can leave its first surface
            // concealed when Explorer subsequently handles Win+D.
            if SetWindowPos(
                hwnd,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            ) == 0
            {
                return Err("无法设置桌面日历窗口层级".into());
            }
        }
    }
    Ok(())
}

fn show(app: &AppHandle, window: &WebviewWindow) -> Result<bool, String> {
    if is_active() {
        return Ok(true);
    }
    let mut config = load_config(app);
    restore_bounds(window, &config)?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window
        .set_always_on_bottom(true)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    set_desktop_owner(window)?;
    ADJUST_MODE.store(false, Ordering::Release);
    INTERACTIVE_MODE.store(false, Ordering::Release);
    ACTIVE.store(true, Ordering::Release);
    capture_bounds(window, &mut config)?;
    config.enabled = true;
    save_config(app, &config)?;
    let _ = app.emit("desktop-calendar://adjust-mode-changed", false);
    let _ = app.emit("desktop-calendar://state-changed", true);
    crate::update_tray_desktop_calendar_menu(app, true);
    Ok(true)
}

fn hide(app: &AppHandle, window: &WebviewWindow) -> Result<bool, String> {
    let mut config = load_config(app);
    if is_active() {
        capture_bounds(window, &mut config)?;
    }
    window.hide().map_err(|e| e.to_string())?;
    ACTIVE.store(false, Ordering::Release);
    ADJUST_MODE.store(false, Ordering::Release);
    INTERACTIVE_MODE.store(false, Ordering::Release);
    config.enabled = false;
    save_config(app, &config)?;
    let _ = app.emit("desktop-calendar://adjust-mode-changed", false);
    let _ = app.emit("desktop-calendar://state-changed", false);
    crate::update_tray_desktop_calendar_menu(app, false);
    Ok(false)
}

pub async fn show_desktop_calendar(app: &AppHandle) -> Result<bool, String> {
    with_window(app, show).await
}

pub async fn hide_desktop_calendar(app: &AppHandle) -> Result<bool, String> {
    with_window(app, hide).await
}

pub async fn toggle_desktop_calendar(app: &AppHandle) -> Result<bool, String> {
    with_window(app, |app, window| {
        if is_active() {
            hide(app, window)
        } else {
            show(app, window)
        }
    })
    .await
}

pub async fn set_adjust_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    with_window(app, move |app, window| {
        if !is_active() || is_adjust_mode() == enabled {
            return Ok(());
        }
        window.set_resizable(enabled).map_err(|e| e.to_string())?;
        window
            .set_always_on_bottom(!enabled && !INTERACTIVE_MODE.load(Ordering::Acquire))
            .map_err(|e| e.to_string())?;
        if enabled {
            window.set_focus().map_err(|e| e.to_string())?;
        }
        ADJUST_MODE.store(enabled, Ordering::Release);
        let mut config = load_config(app);
        capture_bounds(window, &mut config)?;
        save_config(app, &config)?;
        app.emit("desktop-calendar://adjust-mode-changed", enabled)
            .map_err(|e| e.to_string())
    })
    .await
}

pub async fn set_interactive_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    with_window(app, move |_, window| {
        if !is_active() {
            return Ok(());
        }
        window
            .set_always_on_bottom(!enabled && !is_adjust_mode())
            .map_err(|e| e.to_string())?;
        if enabled {
            window.set_focus().map_err(|e| e.to_string())?;
        }
        INTERACTIVE_MODE.store(enabled, Ordering::Release);
        Ok(())
    })
    .await
}

pub async fn set_bounds(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if !is_valid_window_size(width, height) {
        return Ok(());
    }
    with_window(app, move |app, window| {
        window
            .set_size(PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        let mut config = load_config(app);
        capture_bounds(window, &mut config)?;
        save_config(app, &config)
    })
    .await
}

pub async fn set_opacity(app: &AppHandle, opacity: u32) -> Result<(), String> {
    with_window(app, move |app, _| {
        let opacity = opacity.min(90);
        let mut config = load_config(app);
        config.opacity = Some(opacity);
        save_config(app, &config)?;
        app.emit("desktop-calendar://opacity-changed", opacity)
            .map_err(|e| e.to_string())
    })
    .await
}

pub async fn set_show_completed(app: &AppHandle, show_completed: bool) -> Result<(), String> {
    with_window(app, move |app, _| {
        let mut config = load_config(app);
        config.show_completed = Some(show_completed);
        save_config(app, &config)?;
        app.emit("desktop-calendar://show-completed-changed", show_completed)
            .map_err(|e| e.to_string())
    })
    .await
}

pub async fn set_theme_tone(app: &AppHandle, theme_tone: String) -> Result<(), String> {
    with_window(app, move |app, _| {
        let mut config = load_config(app);
        config.theme_tone = Some(theme_tone.clone());
        save_config(app, &config)?;
        app.emit("desktop-calendar://theme-tone-changed", theme_tone)
            .map_err(|e| e.to_string())
    })
    .await
}

pub async fn set_custom_color(app: &AppHandle, custom_color: String) -> Result<(), String> {
    with_window(app, move |app, _| {
        let mut config = load_config(app);
        config.custom_color = Some(custom_color.clone());
        save_config(app, &config)?;
        app.emit("desktop-calendar://custom-color-changed", custom_color)
            .map_err(|e| e.to_string())
    })
    .await
}


pub fn on_window_event(app: &AppHandle, event: &WindowEvent) {
    if !is_active() || !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
        return;
    }
    let revision = BOUNDS_REVISION.fetch_add(1, Ordering::AcqRel) + 1;
    let calendar_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        if revision != BOUNDS_REVISION.load(Ordering::Acquire) {
            return;
        }
        let result = with_window(&calendar_app, move |app, window| {
            if !is_active() || revision != BOUNDS_REVISION.load(Ordering::Acquire) {
                return Ok(());
            }
            let mut config = load_config(app);
            capture_bounds(window, &mut config)?;
            // Saving a move must never issue another move/resize request.
            save_config(app, &config)
        })
        .await;
        if let Err(error) = result {
            eprintln!("failed to save desktop calendar bounds: {error}");
        }
    });
}
