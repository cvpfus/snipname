use std::borrow::Cow;

use image::RgbaImage;
use serde::Deserialize;
use xcap::{Monitor, Window};

use crate::capture::{apply_polygon_mask, save_png, Rect, WindowBounds};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Selection {
    Rect {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
    Freeform {
        points: Vec<Point>,
    },
}

#[derive(Debug, Deserialize, Clone, Copy)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub fn list_other_windows() -> Vec<WindowBounds> {
    let Ok(windows) = Window::all() else {
        return Vec::new();
    };
    windows
        .into_iter()
        .filter_map(|window| bounds_of(&window).ok().flatten())
        .collect()
}

fn bounds_of(window: &Window) -> Result<Option<WindowBounds>, String> {
    if window.is_minimized().unwrap_or(true) {
        return Ok(None);
    }
    let width = window.width().map_err(|e| e.to_string())?;
    let height = window.height().map_err(|e| e.to_string())?;
    if width < 8 || height < 8 {
        return Ok(None);
    }
    let title = window.title().unwrap_or_default();
    if title.is_empty() {
        return Ok(None);
    }
    Ok(Some(WindowBounds {
        id: window.id().unwrap_or(0),
        title,
        app_name: window.app_name().unwrap_or_default(),
        x: window.x().map_err(|e| e.to_string())?,
        y: window.y().map_err(|e| e.to_string())?,
        width,
        height,
    }))
}

pub fn capture_selection(selection: &Selection) -> Result<RgbaImage, String> {
    match selection {
        Selection::Rect {
            x,
            y,
            width,
            height,
        } => capture_desktop_rect(Rect {
            x: *x,
            y: *y,
            width: *width,
            height: *height,
        }),
        Selection::Freeform { points } => capture_freeform(points),
    }
}

fn capture_freeform(points: &[Point]) -> Result<RgbaImage, String> {
    if points.len() < 3 {
        return Err("freeform selection is too small".into());
    }
    let min_x = points.iter().map(|p| p.x).min().unwrap_or(0);
    let min_y = points.iter().map(|p| p.y).min().unwrap_or(0);
    let max_x = points.iter().map(|p| p.x).max().unwrap_or(0);
    let max_y = points.iter().map(|p| p.y).max().unwrap_or(0);
    let width = max_x.saturating_sub(min_x) as u32;
    let height = max_y.saturating_sub(min_y) as u32;
    let mut image = capture_desktop_rect(Rect {
        x: min_x,
        y: min_y,
        width,
        height,
    })?;
    let local: Vec<(i32, i32)> = points
        .iter()
        .map(|point| (point.x - min_x, point.y - min_y))
        .collect();
    let (width, height) = (image.width(), image.height());
    apply_polygon_mask(image.as_mut(), width, height, &local);
    Ok(image)
}

fn capture_desktop_rect(rect: Rect) -> Result<RgbaImage, String> {
    if rect.width < 2 || rect.height < 2 {
        return Err("selection is too small".into());
    }
    let monitors = Monitor::all().map_err(|e| format!("monitors: {e}"))?;
    let mut canvas = RgbaImage::new(rect.width, rect.height);
    let mut painted = false;
    for monitor in monitors {
        let mx = monitor.x().map_err(|e| e.to_string())?;
        let my = monitor.y().map_err(|e| e.to_string())?;
        let mw = monitor.width().map_err(|e| e.to_string())?;
        let mh = monitor.height().map_err(|e| e.to_string())?;
        let Some(local) = rect.clip_to_monitor(mx, my, mw, mh) else {
            continue;
        };
        let shot = monitor
            .capture_region(local.x as u32, local.y as u32, local.width, local.height)
            .map_err(|e| format!("capture: {e}"))?;
        let dest_x = (mx + local.x - rect.x) as u32;
        let dest_y = (my + local.y - rect.y) as u32;
        image::imageops::overlay(&mut canvas, &shot, dest_x as i64, dest_y as i64);
        painted = true;
    }
    if !painted {
        return Err("selection is outside every monitor".into());
    }
    Ok(canvas)
}

pub fn write_png(dir: &std::path::Path, file_name: &str, image: &RgbaImage) -> Result<std::path::PathBuf, String> {
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("encode png: {e}"))?;
    save_png(dir, file_name, &bytes)
}

pub fn copy_image(image: &RgbaImage) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Owned(image.as_raw().clone()),
        })
        .map_err(|e| format!("clipboard image: {e}"))
}
