use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

const UNNAMED: &[&str] = &["Cuplikan layar", "Screenshot", "Screen Shot"];

const NAME_SYSTEM: &str = r#"You name Windows screenshots so people can find them later.
Reply with JSON only: {"name":"kebab-case-filename-stem","reason":"one short sentence"}.
Rules for name: English kebab-case, 3–8 words, no dates, no extension, describe the UI or content (app, error, dialog)."#;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameResult {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub ok: bool,
    pub message: String,
    pub models: Vec<String>,
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

fn slugify(caption: &str) -> String {
    let lower = caption.to_lowercase();
    let mut out = String::new();
    let mut dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    let sliced: String = trimmed.chars().take(60).collect();
    let sliced = sliced.trim_end_matches('-').to_string();
    if sliced.is_empty() {
        "screenshot".into()
    } else {
        sliced
    }
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

#[tauri::command]
async fn check_ollama(ollama_url: String) -> Result<OllamaStatus, String> {
    let base = ollama_url.trim_end_matches('/');
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|e| {
            format!(
                "Cannot reach Ollama at {base}. Is the app running? ({e})"
            )
        })?;
    if !res.status().is_success() {
        return Ok(OllamaStatus {
            ok: false,
            message: format!("Ollama returned HTTP {}", res.status()),
            models: vec![],
        });
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let models = body["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
        .collect::<Vec<_>>();
    Ok(OllamaStatus {
        ok: true,
        message: if models.is_empty() {
            "Ollama is up, but no models are pulled yet. Run: ollama pull gemma3:4b".into()
        } else {
            format!("Ollama ok · {} model(s)", models.len())
        },
        models,
    })
}

#[tauri::command]
async fn name_screenshot(
    path: String,
    ollama_url: String,
    model: String,
) -> Result<NameResult, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    let image_b64 = STANDARD.encode(bytes);
    let base = ollama_url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{base}/api/chat"))
        .json(&json!({
            "model": model,
            "stream": false,
            "format": "json",
            "options": { "temperature": 0, "seed": 7 },
            "messages": [
                { "role": "system", "content": NAME_SYSTEM },
                {
                    "role": "user",
                    "content": "Name this screenshot.",
                    "images": [image_b64]
                }
            ]
        }))
        .send()
        .await
        .map_err(|e| {
            format!(
                "Cannot reach Ollama at {base}. Start Ollama, then try again. ({e})"
            )
        })?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Ollama {status}: {text}"));
    }
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let raw = data["message"]["content"].as_str().unwrap_or("{}");
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("bad model JSON: {e} · raw={raw}"))?;
    let name = parsed["name"]
        .as_str()
        .ok_or_else(|| format!("model returned no name: {raw}"))?;
    let reason = parsed["reason"].as_str().unwrap_or("").to_string();
    Ok(NameResult {
        name: slugify(name),
        reason,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            default_screenshots_dir,
            list_unnamed,
            rename_shot,
            check_ollama,
            name_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
