fn main() {
    let base = std::path::PathBuf::from("../src/i18n/locales");
    println!("cargo:rerun-if-changed={}", base.display());
    let mut locales = serde_json::Map::new();
    let mut dirs = std::fs::read_dir(&base).expect("locale directory").map(|entry| entry.expect("locale directory entry").path()).filter(|path| path.is_dir()).collect::<Vec<_>>();
    dirs.sort();
    for dir in dirs {
        let mut modules = serde_json::Map::new();
        for entry in std::fs::read_dir(&dir).expect("locale files") {
            let path = entry.expect("locale file").path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                let data = std::fs::read_to_string(&path).expect("translation file");
                modules.insert(path.file_stem().unwrap().to_string_lossy().into_owned(), serde_json::from_str(&data).expect("valid translation JSON"));
            }
        }
        locales.insert(dir.file_name().unwrap().to_string_lossy().into_owned(), modules.into());
    }
    let plugins = std::path::PathBuf::from("../plugins");
    println!("cargo:rerun-if-changed={}", plugins.display());
    for entry in std::fs::read_dir(&plugins).expect("bundled plugins") {
        let directory = entry.expect("plugin directory").path();
        let manifest = directory.join("manifest.json");
        if !manifest.is_file() { continue; }
        let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(manifest).expect("plugin manifest")).expect("valid plugin manifest");
        let namespace = manifest["namespace"].as_str().expect("plugin namespace");
        let default = manifest["defaultLocale"].as_str().expect("plugin default locale");
        for (locale, data) in locales.iter_mut() {
            let resource = manifest["locales"][locale].as_str().or_else(|| manifest["locales"][default].as_str()).expect("plugin locale");
            let translations = serde_json::from_slice(&std::fs::read(directory.join(resource)).expect("plugin translations")).expect("valid plugin translations");
            let modules = data.as_object_mut().expect("locale modules");
            assert!(!modules.contains_key(namespace), "duplicate plugin namespace");
            modules.insert(namespace.to_string(), translations);
        }
    }
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("locales.json");
    std::fs::write(output, serde_json::to_vec(&locales).unwrap()).expect("embedded translations");
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-arg=/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::build();
}

