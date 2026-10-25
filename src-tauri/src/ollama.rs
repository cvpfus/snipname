use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::NameResult;

const NAME_SYSTEM: &str = r#"You name Windows screenshots so people can find them later.
Reply with JSON only: {"name":"kebab-case-filename-stem","reason":"one short sentence"}.
Rules for name: English kebab-case, 3–8 words, no dates, no extension, describe the UI or content (app, error, dialog)."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSettings {
    pub url: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub ok: bool,
    pub message: String,
    pub models: Vec<String>,
}

pub async fn check(ollama_url: &str) -> Result<OllamaStatus, String> {
    let base = ollama_url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {base}. Is the app running? ({e})"))?;
    if !res.status().is_success() {
        return Ok(OllamaStatus {
            ok: false,
            message: format!("Ollama returned HTTP {}", res.status()),
            models: vec![],
        });
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let models = body["models"].as_array().map_or_else(Vec::new, |models| {
        models
            .iter()
            .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
            .collect()
    });
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

pub async fn name_image(path: &str, settings: &OllamaSettings) -> Result<NameResult, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let image_b64 = STANDARD.encode(bytes);
    let base = settings.url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{base}/api/chat"))
        .json(&json!({
            "model": settings.model,
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
        .map_err(|e| format!("Cannot reach Ollama at {base}. Start Ollama, then try again. ({e})"))?;
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
        name: crate::slugify(name),
        reason,
    })
}
