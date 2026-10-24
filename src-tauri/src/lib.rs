use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const UNNAMED: &[&str] = &["Cuplikan layar", "Screenshot", "Screen Shot"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    pub name: String,
}

fn is_unnamed(name: &str) -> bool {
    UNNAMED.iter().any(|p| name.starts_with(p))
}

fn shots_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "could not resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join("Pictures").join("Screenshots"))
}

#[tauri::command]
fn default_screenshots_dir() -> Result<String, String> {
    Ok(shots_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_unnamed(dir: String) -> Result<Vec<Shot>, String> {
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir {dir}: {e}"))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if !matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if is_unnamed(&name) {
            out.push(Shot {
                path: path.to_string_lossy().into_owned(),
                name,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn read_image_b64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn rename_shot(from: String, to_name: String) -> Result<String, String> {
    let from_path = Path::new(&from);
    let parent = from_path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let ext = from_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let stem = to_name.trim().trim_end_matches(&format!(".{ext}"));
    let mut dest = parent.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while dest.exists() {
        dest = parent.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    fs::rename(&from, &dest).map_err(|e| format!("rename: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            default_screenshots_dir,
            list_unnamed,
            read_image_b64,
            rename_shot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
