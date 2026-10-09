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
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("locales.json");
    std::fs::write(output, serde_json::to_vec(&locales).unwrap()).expect("embedded translations");
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-arg=/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::build();
}

