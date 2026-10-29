use super::{
    crypto::{self, Header, Sealed},
    model::*,
    storage::{self, Runtime},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::Path,
};
use zeroize::Zeroizing;

// Base64 and the backup envelope add overhead to a valid 32 MiB vault snapshot.
const MAX_FILE: u64 = 64 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    header: Header,
    data: Sealed,
}
#[derive(Serialize)]
struct ImportWarning {
    code: &'static str,
    name: String,
}
fn file_bytes(path: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "VAULT_FILE")?;
    if file.metadata().map_err(|_| "VAULT_FILE")?.len() > MAX_FILE {
        return Err("VAULT_FILE_SIZE".into());
    }
    use std::io::Read;
    let mut bytes = Zeroizing::new(Vec::new());
    (&mut file)
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "VAULT_FILE")?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("VAULT_FILE_SIZE".into());
    }
    Ok(bytes)
}
fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn duplicate(a: &Entry, b: &Entry) -> bool {
    a.deleted_at.is_some() == b.deleted_at.is_some()
        && a.kind == b.kind
        && if a.kind == "ssh" {
            !a.fingerprint.is_empty() && a.fingerprint == b.fingerprint
        } else {
            a.name == b.name && a.username == b.username && a.urls == b.urls
        }
}
fn decode(
    payload: &Value,
    bytes: &[u8],
) -> Result<(Zeroizing<Contents>, Vec<ImportWarning>), String> {
    let format = storage::text(payload, "format")?;
    let mut c = Zeroizing::new(Contents::default());
    let mut warnings = vec![];
    match format {
        "encrypted" => {
            let backup: Backup = serde_json::from_slice(bytes).map_err(|_| "VAULT_FORMAT")?;
            if backup.format != "lanmind-vault-v1" {
                return Err("VAULT_FORMAT".into());
            }
            let key = crypto::unwrap(payload["password"].as_str().unwrap_or(""), &backup.header)?;
            let raw = crypto::open(&key, &backup.data, b"lanmind-vault-backup-v1")?;
            if raw.len() > 32 * 1024 * 1024 {
                return Err("VAULT_FILE_SIZE".into());
            }
            c = Zeroizing::new(serde_json::from_slice(&raw).map_err(|_| "VAULT_FORMAT")?);
        }
        "bitwarden" => {
            let value: Value = serde_json::from_slice(bytes).map_err(|_| "VAULT_FORMAT")?;
            if value["encrypted"] == true {
                return Err("VAULT_FORMAT".into());
            }
            if let Some(folders) = value["folders"].as_array() {
                for f in folders {
                    c.folders.push(Folder {
                        id: storage::text(f, "id")?.into(),
                        name: storage::text(f, "name")?.into(),
                        parent_id: None,
                    });
                }
            }
            for item in value["items"].as_array().ok_or("VAULT_FORMAT")? {
                if item["type"] != 1 {
                    warnings.push(ImportWarning {
                        code: "unsupportedItem",
                        name: item["name"].as_str().unwrap_or("").into(),
                    });
                    continue;
                }
                let e = Entry {
                    id: id(),
                    name: item["name"].as_str().unwrap_or("").into(),
                    folder_id: item["folderId"].as_str().map(str::to_string),
                    username: item["login"]["username"].as_str().unwrap_or("").into(),
                    password: item["login"]["password"].as_str().unwrap_or("").into(),
                    urls: item["login"]["uris"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|v| v["uri"].as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default(),
                    notes: item["notes"].as_str().unwrap_or("").into(),
                    favorite: item["favorite"].as_bool().unwrap_or(false),
                    ..Entry::default()
                };
                if item["login"]["totp"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
                    || item["fields"].as_array().is_some_and(|v| !v.is_empty())
                    || item["attachments"]
                        .as_array()
                        .is_some_and(|v| !v.is_empty())
                {
                    warnings.push(ImportWarning {
                        code: "unsupportedFields",
                        name: e.name.clone(),
                    });
                }
                c.entries.push(e);
            }
        }
        "csv" => {
            let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(bytes);
            let headers = reader.headers().map_err(|_| "VAULT_FORMAT")?.clone();
            let mapping = &payload["mapping"];
            let column = |name: &str| -> Option<usize> {
                let label = mapping[name].as_str().unwrap_or(name);
                if label.is_empty() {
                    return None;
                }
                headers
                    .iter()
                    .position(|h| h.trim_start_matches('\u{feff}').eq_ignore_ascii_case(label))
            };
            if column("name").is_none() {
                return Err("VAULT_CSV_MAPPING".into());
            }
            let mut folders = HashMap::new();
            for row in reader.records() {
                let row = row.map_err(|_| "VAULT_FORMAT")?;
                let get = |name: &str| {
                    column(name)
                        .and_then(|index| row.get(index))
                        .unwrap_or("")
                        .to_string()
                };
                let folder_name = get("folder");
                let folder_id = if folder_name.is_empty() {
                    None
                } else {
                    Some(
                        folders
                            .entry(folder_name.clone())
                            .or_insert_with(|| {
                                let id = id();
                                c.folders.push(Folder {
                                    id: id.clone(),
                                    name: folder_name,
                                    parent_id: None,
                                });
                                id
                            })
                            .clone(),
                    )
                };
                let url = get("url");
                c.entries.push(Entry {
                    id: id(),
                    name: get("name"),
                    username: get("username"),
                    password: get("password"),
                    notes: get("notes"),
                    urls: if url.is_empty() { vec![] } else { vec![url] },
                    folder_id,
                    ..Entry::default()
                });
            }
        }
        _ => return Err("VAULT_FORMAT".into()),
    }
    if c.entries.len() > 20000 || c.folders.len() > 5000 {
        return Err("VAULT_FILE_SIZE".into());
    }
    let mut ids = HashSet::new();
    for folder in &c.folders {
        if folder.id.is_empty() || folder.name.trim().is_empty() || !ids.insert(folder.id.clone()) {
            return Err("VAULT_FORMAT".into());
        }
    }
    for folder in &c.folders {
        let mut seen = HashSet::new();
        let mut next = Some(folder.id.clone());
        while let Some(id) = next {
            if !seen.insert(id.clone()) {
                return Err("VAULT_FOLDER_CYCLE".into());
            }
            next = c
                .folders
                .iter()
                .find(|f| f.id == id)
                .ok_or("VAULT_FORMAT")?
                .parent_id
                .clone();
        }
        if c.folders.iter().any(|f| {
            f.id != folder.id
                && f.parent_id == folder.parent_id
                && f.name.to_lowercase() == folder.name.to_lowercase()
        }) {
            return Err("VAULT_FOLDER_EXISTS".into());
        }
    }
    let mut valid = Vec::new();
    for mut entry in std::mem::take(&mut c.entries) {
        if storage::validate_entry(&mut entry, &c.folders).is_ok() {
            valid.push(entry);
        } else {
            warnings.push(ImportWarning {
                code: "invalidItem",
                name: entry.name.clone(),
            });
        }
    }
    c.entries = valid;
    Ok((c, warnings))
}
impl Runtime {
    pub fn import(&self, payload: Value, expected: u64, commit: bool) -> Result<Value, String> {
        let bytes = file_bytes(storage::text(&payload, "path")?)?;
        let hash = fingerprint(&bytes);
        if commit && payload["fileHash"] != hash {
            return Err("VAULT_IMPORT_CHANGED".into());
        }
        let (mut imported, warnings) = decode(&payload, &bytes)?;
        self.with(expected,|conn,key,c|{
            let duplicates=imported.entries.iter().filter(|e|c.entries.iter().any(|old|duplicate(e,old))).count();
            if !commit {return Ok(json!({"count":imported.entries.len(),"folderCount":imported.folders.len(),"duplicates":duplicates,"warnings":warnings,"fileHash":hash,"entries":imported.entries.iter().map(Entry::summary).collect::<Vec<_>>(),"folders":imported.folders}));}
            if payload["format"]=="encrypted" {
                if ![1,5,15,30,60].contains(&imported.idle_minutes){return Err("VAULT_FORMAT".into());}
                super::generator::generate(&imported.policy)?;c.policy=imported.policy.clone();c.idle_minutes=imported.idle_minutes;
            }
            let mut map=HashMap::new();
            for folder in &imported.folders {map.insert(folder.id.clone(),id());}
            // Remap all IDs before appending. Imported objects never overwrite local ones.
            for folder in &mut imported.folders {folder.id=map[&folder.id].clone();folder.parent_id=folder.parent_id.as_ref().and_then(|p|map.get(p).cloned());}
            // Avoid duplicate sibling folders by merging their paths into existing ones.
            let mut resolved=HashMap::<String,String>::new();
            let mut pending=imported.folders.clone();
            while !pending.is_empty(){
                let index=pending.iter().position(|f|f.parent_id.as_ref().is_none_or(|p|resolved.contains_key(p))).ok_or("VAULT_FOLDER_CYCLE")?;
                let mut folder=pending.remove(index);let previous=folder.id.clone();folder.parent_id=folder.parent_id.as_ref().and_then(|p|resolved.get(p).cloned());
                if let Some(existing)=c.folders.iter().find(|f|f.name.to_lowercase()==folder.name.to_lowercase()&&f.parent_id==folder.parent_id){resolved.insert(previous,existing.id.clone());}
                else{resolved.insert(previous,folder.id.clone());c.folders.push(folder);}
            }
            let mut added=0;
            for mut entry in std::mem::take(&mut imported.entries){
                if payload["skipDuplicates"]==true && c.entries.iter().any(|old|duplicate(&entry,old)){continue;}
                entry.id=id();entry.revision=1;entry.source_share_id=None;
                entry.folder_id=entry.folder_id.as_ref().and_then(|old|map.get(old)).and_then(|id|resolved.get(id)).cloned();
                if entry.created_at.is_empty(){entry.created_at=now();}entry.updated_at=now();c.entries.push(entry);added+=1;
            }
            storage::write(conn,key,c)?;Ok(json!({"added":added,"warnings":warnings}))
        })
    }
    pub fn export(&self, payload: Value, expected: u64) -> Result<Value, String> {
        self.with(expected,|conn,_key,c|{
            let format=storage::text(&payload,"format")?;
            if format!="encrypted" {crypto::unwrap(storage::text(&payload,"currentPassword")?,&storage::header(conn)?)?;}
            let selected=payload["ids"].as_array();
            let mut out=Zeroizing::new(c.clone());out.share_secret.clear();
            out.entries.retain(|e|(selected.is_none_or(|ids|ids.iter().any(|id|id==&e.id)))&&(format=="encrypted"||e.deleted_at.is_none()));
            let bytes=match format{
                "encrypted"=>{
                    let password=storage::text(&payload,"password")?;if password.chars().count()<12{return Err("VAULT_MASTER_LENGTH".into());}
                    let backup_key=crypto::random_key();let header=crypto::wrap(password,id(),&backup_key)?;
                    let raw=Zeroizing::new(serde_json::to_vec(&*out).map_err(|_|"VAULT_INVALID")?);
                    let data=crypto::seal(&backup_key,&raw,b"lanmind-vault-backup-v1")?;
                    Zeroizing::new(serde_json::to_vec(&Backup{format:"lanmind-vault-v1".into(),header,data}).map_err(|_|"VAULT_INVALID")?)
                },
                "bitwarden"=>{
                    let folders:Vec<_>=out.folders.iter().map(|f|json!({"id":f.id,"name":folder_path(&out.folders,&f.id)})).collect();
                    let items:Vec<_>=out.entries.iter().filter(|e|e.kind=="login").map(|e|json!({"id":e.id,"type":1,"name":e.name,"folderId":e.folder_id,"favorite":e.favorite,"notes":e.notes,"login":{"username":e.username,"password":e.password,"uris":e.urls.iter().map(|url|json!({"uri":url,"match":null})).collect::<Vec<_>>()}})).collect();
                    Zeroizing::new(serde_json::to_vec(&json!({"encrypted":false,"folders":folders,"items":items})).map_err(|_|"VAULT_INVALID")?)
                },
                "csv"=>{
                    let mut writer=csv::Writer::from_writer(Vec::new());writer.write_record(["name","url","username","password","notes","folder"]).map_err(|_|"VAULT_FILE")?;
                    for e in out.entries.iter().filter(|e|e.kind=="login"){writer.write_record([e.name.as_str(),e.urls.first().map(String::as_str).unwrap_or(""),&e.username,&e.password,&e.notes,&e.folder_id.as_ref().map(|id|folder_path(&out.folders,id)).unwrap_or_default()]).map_err(|_|"VAULT_FILE")?;}
                    Zeroizing::new(writer.into_inner().map_err(|_|"VAULT_FILE")?)
                },
                "ssh"=>{
                    let entry=out.entries.iter().find(|e|e.kind=="ssh"&&!e.private_key.is_empty()).ok_or("VAULT_NOT_FOUND")?;
                    Zeroizing::new(entry.private_key.as_bytes().to_vec())
                },
                _=>return Err("VAULT_FORMAT".into())
            };
            write_file(storage::text(&payload,"path")?,&bytes)?;
            Ok(json!({"count":out.entries.iter().filter(|e|format=="encrypted"||format=="ssh"||e.kind=="login").count(),"excludedSsh":if format=="csv"||format=="bitwarden"{out.entries.iter().filter(|e|e.kind=="ssh").count()}else{0}}))
        })
    }
}
fn folder_path(folders: &[Folder], id: &str) -> String {
    let mut parts = vec![];
    let mut next = Some(id.to_string());
    while let Some(id) = next {
        let Some(folder) = folders.iter().find(|f| f.id == id) else {
            break;
        };
        parts.push(folder.name.clone());
        next = folder.parent_id.clone();
        if parts.len() > folders.len() {
            break;
        }
    }
    parts.reverse();
    parts.join("/")
}
fn write_file(path: &str, bytes: &[u8]) -> Result<(), String> {
    let path = Path::new(path);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "VAULT_FILE_EXISTS")?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err("VAULT_FILE".into());
    }
    Ok(())
}
