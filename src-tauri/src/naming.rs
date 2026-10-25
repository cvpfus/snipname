use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::ollama::{name_image, OllamaSettings};
use crate::rename_shot;

#[derive(Clone)]
pub struct NamingQueue {
    tx: Sender<Job>,
}

struct Job {
    path: String,
    settings: OllamaSettings,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShotNamed {
    from: String,
    to: String,
    name: String,
    reason: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShotNameFailed {
    path: String,
    error: String,
}

impl NamingQueue {
    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        thread::spawn(move || {
            while let Ok(job) = rx.recv() {
                let app = app.clone();
                // Block this worker, not the capture path. A second snip queues behind this one.
                match tauri::async_runtime::block_on(name_image(&job.path, &job.settings)) {
                    Ok(named) => match rename_shot(job.path.clone(), named.name.clone()) {
                        Ok(dest) => {
                            let _ = app.emit(
                                "shot-named",
                                ShotNamed {
                                    from: job.path,
                                    to: dest,
                                    name: named.name,
                                    reason: named.reason,
                                },
                            );
                        }
                        Err(error) => emit_failure(&app, job.path, error),
                    },
                    Err(error) => emit_failure(&app, job.path, error),
                }
            }
        });
        Self { tx }
    }

    pub fn enqueue(&self, path: String, settings: OllamaSettings) {
        let _ = self.tx.send(Job { path, settings });
    }
}

fn emit_failure(app: &AppHandle, path: String, error: String) {
    let _ = app.emit("shot-name-failed", ShotNameFailed { path, error });
}

pub fn enqueue(app: &AppHandle, path: impl AsRef<Path>, settings: OllamaSettings) {
    if let Some(queue) = app.try_state::<NamingQueue>() {
        queue.enqueue(path.as_ref().to_string_lossy().into_owned(), settings);
    }
}
