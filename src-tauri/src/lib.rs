mod capture;
mod naming;
mod ollama;
mod screen;

use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};

use capture::provisional_name;
use naming::NamingQueue;
use ollama::{OllamaSettings, OllamaStatus};
use screen::Selection;

const UNNAMED: &[&str] = &["Cuplikan layar", "Screenshot", "Screen Shot"];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NameResult {
    pub name: String,
    pub reason: String,
}

struct SettingsState(Mutex<OllamaSettings>);
struct SnipModeState(Mutex<String>);

fn preview_data_url(image: &image::RgbaImage) -> String {
    let thumb = image::imageops::thumbnail(image, 640, 400);
    let mut bytes = Vec::new();
    if thumb
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .is_err()
    {
        return String::new();
    }
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
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

pub fn slugify(caption: &str) -> String {
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
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read_dir {dir}: {e}"))?;
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

pub fn rename_shot(from: String, to_name: String) -> Result<String, String> {
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
    std::fs::rename(&from, &dest).map_err(|e| format!("rename: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_shot_command(from: String, to_name: String) -> Result<String, String> {
    rename_shot(from, to_name)
}

#[tauri::command]
async fn check_ollama(ollama_url: String) -> Result<OllamaStatus, String> {
    ollama::check(&ollama_url).await
}

#[tauri::command]
async fn name_screenshot(
    path: String,
    ollama_url: String,
    model: String,
) -> Result<NameResult, String> {
    ollama::name_image(
        &path,
        &OllamaSettings {
            url: ollama_url,
            model,
        },
    )
    .await
}

#[tauri::command]
fn remember_settings(state: State<SettingsState>, ollama_url: String, model: String) {
    *state.0.lock().expect("settings") = OllamaSettings {
        url: ollama_url,
        model,
    };
}

#[tauri::command]
fn list_windows() -> Vec<capture::WindowBounds> {
    screen::list_other_windows()
        .into_iter()
        .filter(|window| !is_own_overlay(window))
        .collect()
}

fn is_own_overlay(window: &capture::WindowBounds) -> bool {
    window.title == "Snipname capture" || window.title == "Snipname"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShotSaved {
    path: String,
    name: String,
    copied: bool,
    preview: String,
}

#[tauri::command]
async fn capture_selection(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, SettingsState>,
    selection: Selection,
    offset_minutes: i32,
) -> Result<ShotSaved, String> {
    // Hide before capture so the dim and toolbar are not in the snip.
    let _ = window.hide();
    // The compositor needs a frame after hide, or the dim is in the snip.
    std::thread::sleep(std::time::Duration::from_millis(120));
    let image = tauri::async_runtime::spawn_blocking(move || screen::capture_selection(&selection))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let copied = screen::copy_image(&image).is_ok();
    let dir = shots_dir()?;
    let file_name = provisional_name(std::time::SystemTime::now(), offset_minutes);
    let saved = screen::write_png(&dir, &file_name, &image)?;
    let preview = preview_data_url(&image);
    let shot = ShotSaved {
        path: saved.to_string_lossy().into_owned(),
        name: saved
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&file_name)
            .to_string(),
        copied,
        preview,
    };
    let settings = state.0.lock().expect("settings").clone();
    naming::enqueue(&app, &shot.path, settings);
    let _ = app.emit("shot-saved", shot.clone());
    Ok(shot)
}

#[tauri::command]
fn current_snip_mode(state: State<SnipModeState>) -> String {
    state.0.lock().expect("snip mode").clone()
}

#[tauri::command]
fn report_snip_error(app: AppHandle, error: String) {
    let _ = app.emit(
        "shot-name-failed",
        serde_json::json!({ "path": "", "error": error }),
    );
}

#[tauri::command]
fn show_main(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
async fn open_overlay(app: AppHandle, state: State<'_, SnipModeState>, mode: String) -> Result<(), String> {
    *state.0.lock().expect("snip mode") = mode.clone();
    if let Some(existing) = app.get_webview_window("overlay") {
        let _ = existing.emit("overlay-mode", mode.clone());
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .map(|url| {
            let mut overlay = url;
            overlay.set_query(Some(&format!("overlay=1&mode={mode}")));
            WebviewUrl::External(overlay)
        })
        .unwrap_or_else(|| WebviewUrl::App(format!("index.html?overlay=1&mode={mode}").into()));
    let overlay = tauri::WebviewWindowBuilder::new(&app, "overlay", url)
        .title("Snipname capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focused(true)
        .visible(true)
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = overlay.emit("overlay-mode", mode);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(SettingsState(Mutex::new(OllamaSettings {
            url: "http://127.0.0.1:11434".into(),
            model: "gemma3:4b".into(),
        })))
        .manage(SnipModeState(Mutex::new("rectangle".into())))
        .setup(|app| {
            app.manage(NamingQueue::start(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_screenshots_dir,
            list_unnamed,
            rename_shot_command,
            check_ollama,
            name_screenshot,
            remember_settings,
            list_windows,
            capture_selection,
            open_overlay,
            show_main,
            current_snip_mode,
            report_snip_error,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
