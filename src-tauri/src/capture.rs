use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Windows Snipping Tool names a snip before the user can name it.
/// We do the same, then Gemma replaces the stem in the background.
/// `offset_minutes` is the browser's local offset east of UTC.
pub fn provisional_name(when: SystemTime, offset_minutes: i32) -> String {
    let secs = when
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stamp = utc_stamp(secs.wrapping_add_signed(offset_minutes as i64 * 60));
    format!("Cuplikan layar {stamp}.png")
}

fn utc_stamp(secs: u64) -> String {
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    let hour = tod / 3_600;
    let minute = (tod % 3_600) / 60;
    let second = tod % 60;
    format!("{year:04}-{month:02}-{day:02} {hour:02}{minute:02}{second:02}")
}

/// Howard Hinnant civil_from_days. Days since 1970-01-01.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month as u32, day as u32)
}

trait WrappingAddSigned {
    fn wrapping_add_signed(self, offset: i64) -> Self;
}

impl WrappingAddSigned for u64 {
    fn wrapping_add_signed(self, offset: i64) -> Self {
        if offset >= 0 {
            self.wrapping_add(offset as u64)
        } else {
            self.wrapping_sub(offset.unsigned_abs())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn from_drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Option<Self> {
        let left = x1.min(x2);
        let top = y1.min(y2);
        let width = x1.abs_diff(x2);
        let height = y1.abs_diff(y2);
        if width < 2 || height < 2 {
            return None;
        }
        Some(Self {
            x: left,
            y: top,
            width,
            height,
        })
    }

    /// Intersection with a monitor rectangle whose origin is (`mx`, `my`).
    /// Returned x/y are relative to that monitor, which is what capture_region wants.
    pub fn clip_to_monitor(self, mx: i32, my: i32, mw: u32, mh: u32) -> Option<Self> {
        let x1 = self.x.max(mx);
        let y1 = self.y.max(my);
        let x2 = (self.x as i64 + self.width as i64).min(mx as i64 + mw as i64) as i32;
        let y2 = (self.y as i64 + self.height as i64).min(my as i64 + mh as i64) as i32;
        if x2 <= x1 || y2 <= y1 {
            return None;
        }
        Some(Self {
            x: x1 - mx,
            y: y1 - my,
            width: (x2 - x1) as u32,
            height: (y2 - y1) as u32,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn save_png(dir: &Path, stem_with_ext: &str, png: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("create {dir:?}: {e}"))?;
    let dest = unique_path(dir, stem_with_ext);
    fs::write(&dest, png).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(dest)
}

fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("screenshot");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let mut dest = dir.join(format!("{stem}.{ext}"));
    let mut n = 2u32;
    while dest.exists() {
        dest = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    dest
}

/// Point-in-polygon, boundary counts as inside. Used by freeform snips.
pub fn point_in_polygon(x: f32, y: f32, polygon: &[(f32, f32)]) -> bool {
    if polygon.len() < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let (xi, yi) = polygon[i];
        let (xj, yj) = polygon[j];
        let intersects = (yi > y) != (yj > y)
            && x < (xj - xi) * (y - yi) / (yj - yi + f32::EPSILON) + xi;
        if intersects {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Mask pixels outside the polygon to transparent, matching Snipping Tool's freeform snip.
pub fn apply_polygon_mask(rgba: &mut [u8], width: u32, height: u32, polygon: &[(i32, i32)]) {
    let poly: Vec<(f32, f32)> = polygon
        .iter()
        .map(|(x, y)| (*x as f32, *y as f32))
        .collect();
    let w = width as usize;
    let h = height as usize;
    if rgba.len() < w * h * 4 || poly.len() < 3 {
        return;
    }
    for y in 0..h {
        for x in 0..w {
            if !point_in_polygon(x as f32 + 0.5, y as f32 + 0.5, &poly) {
                let i = (y * w + x) * 4;
                rgba[i + 3] = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provisional_name_matches_windows_pattern() {
        let name = provisional_name(
            UNIX_EPOCH + std::time::Duration::from_secs(1_760_400_000),
            7 * 60,
        );
        assert!(name.starts_with("Cuplikan layar "));
        assert!(name.ends_with(".png"));
        let stamp = name
            .trim_start_matches("Cuplikan layar ")
            .trim_end_matches(".png");
        assert_eq!(stamp.len(), 17, "{stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], " ");
    }

    #[test]
    fn drag_normalizes_any_corner() {
        let rect = Rect::from_drag(40, 10, 10, 50).unwrap();
        assert_eq!(
            rect,
            Rect {
                x: 10,
                y: 10,
                width: 30,
                height: 40
            }
        );
        assert!(Rect::from_drag(1, 1, 2, 8).is_none());
    }

    #[test]
    fn clip_keeps_only_the_part_on_the_monitor() {
        let rect = Rect {
            x: -20,
            y: 10,
            width: 100,
            height: 40,
        };
        let clipped = rect.clip_to_monitor(0, 0, 1920, 1080).unwrap();
        assert_eq!(clipped.x, 0);
        assert_eq!(clipped.width, 80);
        assert!(Rect {
            x: 2000,
            y: 0,
            width: 10,
            height: 10
        }
        .clip_to_monitor(0, 0, 1920, 1080)
        .is_none());
    }

    #[test]
    fn polygon_includes_its_interior_only() {
        let square = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        assert!(point_in_polygon(5.0, 5.0, &square));
        assert!(!point_in_polygon(15.0, 5.0, &square));
    }

    #[test]
    fn mask_clears_pixels_outside_the_lasso() {
        let mut rgba = vec![255u8; 4 * 4 * 4];
        apply_polygon_mask(&mut rgba, 4, 4, &[(1, 1), (2, 1), (2, 2), (1, 2)]);
        assert_eq!(rgba[0 + 3], 0);
        assert_eq!(rgba[((1 * 4 + 1) * 4) + 3], 255);
    }

    #[test]
    fn unique_path_numbers_collisions_like_windows() {
        let dir = std::env::temp_dir().join(format!(
            "snipname-unique-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let first = save_png(&dir, "Cuplikan layar 2026-10-25 120000.png", b"a").unwrap();
        let second = save_png(&dir, "Cuplikan layar 2026-10-25 120000.png", b"b").unwrap();
        assert!(first.ends_with("Cuplikan layar 2026-10-25 120000.png"));
        assert!(second
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .contains("(2)"));
        let _ = fs::remove_dir_all(&dir);
    }
}
