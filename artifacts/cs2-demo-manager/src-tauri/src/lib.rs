use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────
//  Shared types
// ─────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DemoEntry {
    pub filename: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub filepath: String,
    pub directory: String,
    pub size: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct LaunchResult {
    pub status: String,
    pub command: Option<String>,
}

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

fn file_modified_iso(path: &Path) -> String {
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                let total_secs = dur.as_secs();
                let secs = total_secs % 60;
                let total_mins = total_secs / 60;
                let mins = total_mins % 60;
                let total_hrs = total_mins / 60;
                let hrs = total_hrs % 24;
                let total_days = total_hrs / 24;

                let mut year = 1970u32;
                let mut remaining_days = total_days;
                loop {
                    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
                    let days_in_year: u64 = if leap { 366 } else { 365 };
                    if remaining_days < days_in_year {
                        break;
                    }
                    remaining_days -= days_in_year;
                    year += 1;
                }
                let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
                let month_days: [u64; 12] = [
                    31, if leap { 29 } else { 28 },
                    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
                ];
                let mut month = 1u32;
                for &d in &month_days {
                    if remaining_days < d {
                        break;
                    }
                    remaining_days -= d;
                    month += 1;
                }
                let day = remaining_days + 1;
                return format!(
                    "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                    year, month, day, hrs, mins, secs
                );
            }
        }
    }
    "1970-01-01T00:00:00Z".to_string()
}

fn demo_entry_from_path(path: &Path) -> Option<DemoEntry> {
    let filename = path.file_name()?.to_string_lossy().to_string();
    let display_name = if filename.ends_with(".dem") {
        filename[..filename.len() - 4].to_string()
    } else {
        filename.clone()
    };
    let directory = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let modified_at = file_modified_iso(path);
    Some(DemoEntry {
        filename,
        display_name,
        filepath: path.to_string_lossy().to_string(),
        directory,
        size,
        modified_at,
    })
}

// ─────────────────────────────────────────
//  Commands — local file management
// ─────────────────────────────────────────

#[tauri::command]
pub fn list_demos(directory: String) -> Result<Vec<DemoEntry>, String> {
    let dir = Path::new(&directory);
    if !dir.exists() {
        return Ok(vec![]);
    }
    if !dir.is_dir() {
        return Err(format!("Der Pfad ist kein Ordner: {}", directory));
    }
    let mut demos = Vec::new();
    let read_dir = fs::read_dir(dir)
        .map_err(|e| format!("Ordner konnte nicht gelesen werden: {}", e))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.ends_with(".dem") {
                if let Some(demo) = demo_entry_from_path(&path) {
                    demos.push(demo);
                }
            }
        }
    }
    demos.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(demos)
}

#[tauri::command]
pub fn import_demo(
    source_path: String,
    dest_dir: String,
    extract_gz: bool,
) -> Result<DemoEntry, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("Quelldatei nicht gefunden: {}", source_path));
    }
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest)
        .map_err(|e| format!("Zielordner konnte nicht erstellt werden: {}", e))?;
    let src_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if src_name.ends_with(".dem.gz") && extract_gz {
        let dem_name = &src_name[..src_name.len() - 3];
        let dest_path = dest.join(dem_name);
        let gz_file = fs::File::open(&src)
            .map_err(|e| format!("Datei konnte nicht geöffnet werden: {}", e))?;
        let mut decoder = GzDecoder::new(BufReader::new(gz_file));
        let mut out_file = fs::File::create(&dest_path)
            .map_err(|e| format!("Zieldatei konnte nicht erstellt werden: {}", e))?;
        let mut buf = Vec::new();
        decoder
            .read_to_end(&mut buf)
            .map_err(|e| format!("Die Demo-Datei konnte nicht entpackt werden: {}", e))?;
        out_file
            .write_all(&buf)
            .map_err(|e| format!("Entpackte Datei konnte nicht gespeichert werden: {}", e))?;
        demo_entry_from_path(&dest_path)
            .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
    } else if src_name.ends_with(".dem") {
        let dest_path = dest.join(&src_name);
        fs::copy(&src, &dest_path)
            .map_err(|e| format!("Datei konnte nicht kopiert werden: {}", e))?;
        demo_entry_from_path(&dest_path)
            .ok_or_else(|| "Fehler beim Lesen der kopierten Demo.".to_string())
    } else {
        Err(format!(
            "Nicht unterstütztes Format: \"{}\". Nur .dem und .dem.gz werden akzeptiert.",
            src_name
        ))
    }
}

#[tauri::command]
pub fn delete_demo_file(filepath: String) -> Result<(), String> {
    let path = PathBuf::from(&filepath);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path)
        .map_err(|e| format!("Datei konnte nicht gelöscht werden: {}", e))
}

#[tauri::command]
pub fn rename_demo_file(filepath: String, new_name: String) -> Result<String, String> {
    let src = PathBuf::from(&filepath);
    if !src.exists() {
        return Err(format!("Datei nicht gefunden: {}", filepath));
    }
    let parent = src.parent().ok_or("Übergeordnetes Verzeichnis nicht gefunden.")?;
    let safe_name = if new_name.ends_with(".dem") {
        new_name.clone()
    } else {
        format!("{}.dem", new_name)
    };
    let dest = parent.join(&safe_name);
    fs::rename(&src, &dest)
        .map_err(|e| format!("Datei konnte nicht umbenannt werden: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let dir = if p.is_file() {
        p.parent()
            .map(|pp| pp.to_string_lossy().to_string())
            .unwrap_or(path.clone())
    } else {
        path.clone()
    };
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(&dir).spawn()
            .map_err(|e| format!("Ordner konnte nicht geöffnet werden: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&dir).spawn()
            .map_err(|e| format!("Ordner konnte nicht geöffnet werden: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let managers = ["xdg-open", "nautilus", "dolphin", "thunar", "nemo"];
        let mut launched = false;
        for mgr in &managers {
            if Command::new(mgr).arg(&dir).spawn().is_ok() {
                launched = true;
                break;
            }
        }
        if !launched {
            return Err("Kein Dateimanager gefunden.".to_string());
        }
    }
    Ok(())
}

// ─────────────────────────────────────────
//  Commands — CS2 launch
// ─────────────────────────────────────────

fn open_url_os(url: &str) -> bool {
    #[cfg(target_os = "windows")]
    { Command::new("cmd").args(["/C", "start", "", url]).spawn().is_ok() }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(url).spawn().is_ok() }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(url).spawn().is_ok() }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { false }
}

#[tauri::command]
pub fn launch_cs2(cs2_exe_path: String, demo_path: String) -> Result<LaunchResult, String> {
    let playdemo_cmd = format!("playdemo \"{}\"", demo_path);
    let steam_uri = format!("steam://rungame/730/0/+playdemo+\"{}\"", demo_path);

    if open_url_os(&steam_uri) {
        return Ok(LaunchResult { status: "launched".to_string(), command: None });
    }
    if !cs2_exe_path.is_empty() {
        let cs2 = PathBuf::from(&cs2_exe_path);
        if cs2.exists() && Command::new(&cs2).args(["-game", "csgo", "+playdemo", &demo_path]).spawn().is_ok() {
            return Ok(LaunchResult { status: "launched".to_string(), command: None });
        }
    }
    Ok(LaunchResult {
        status: "clipboard_fallback".to_string(),
        command: Some(playdemo_cmd),
    })
}

#[tauri::command]
pub fn check_cs2_path(cs2_path: String) -> bool {
    !cs2_path.is_empty() && PathBuf::from(&cs2_path).exists()
}

#[tauri::command]
pub fn detect_steam_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
            r"D:\Steam",
            r"D:\Program Files (x86)\Steam",
            r"E:\Steam",
        ];
        for c in &candidates {
            if Path::new(c).exists() { return Some(c.to_string()); }
        }
        None
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = [
            format!("{}/.steam/steam", home),
            format!("{}/.local/share/Steam", home),
        ];
        for c in &candidates {
            if Path::new(c.as_str()).exists() { return Some(c.clone()); }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidate = format!("{}/Library/Application Support/Steam", home);
        if Path::new(&candidate).exists() { Some(candidate) } else { None }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { None }
}

#[tauri::command]
pub fn get_file_info(filepath: String) -> Result<DemoEntry, String> {
    let path = PathBuf::from(&filepath);
    demo_entry_from_path(&path)
        .ok_or_else(|| format!("Dateiinfo konnte nicht gelesen werden: {}", filepath))
}

// ─────────────────────────────────────────
//  Command — FACEIT demo download
// ─────────────────────────────────────────

/// Download a FACEIT demo from a URL.
/// Detects .gz magic bytes and extracts automatically if needed.
/// Returns the saved .dem DemoEntry.
#[tauri::command]
pub async fn download_demo(
    url: String,
    dest_dir: String,
    filename: String,
    auth_token: Option<String>,
) -> Result<DemoEntry, String> {
    // Prepare destination
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest)
        .map_err(|e| format!("Zielordner konnte nicht erstellt werden: {}", e))?;

    // Build HTTP request
    let client = reqwest::Client::builder()
        .user_agent("CS2DemoManager/1.0")
        .build()
        .map_err(|e| format!("HTTP-Client Fehler: {}", e))?;

    let mut req = client.get(&url);
    if let Some(token) = auth_token {
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Download fehlgeschlagen: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download fehlgeschlagen: HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Dateiinhalt konnte nicht gelesen werden: {}", e))?;

    // Strip query params from filename
    let clean_name: String = filename
        .split('?')
        .next()
        .unwrap_or(&filename)
        .to_string();

    // Detect if the bytes are gzip (magic bytes 0x1F 0x8B)
    let is_gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;
    let is_gz_ext = clean_name.ends_with(".dem.gz") || clean_name.ends_with(".gz");

    if is_gzip || is_gz_ext {
        // Determine output .dem filename
        let dem_name = if clean_name.ends_with(".dem.gz") {
            clean_name[..clean_name.len() - 7].to_string() + ".dem"
        } else if clean_name.ends_with(".gz") {
            clean_name[..clean_name.len() - 3].to_string()
        } else {
            format!("{}.dem", clean_name)
        };

        let dest_path = dest.join(&dem_name);
        let cursor = std::io::Cursor::new(bytes.as_ref());
        let mut decoder = GzDecoder::new(cursor);
        let mut decompressed = Vec::new();
        decoder
            .read_to_end(&mut decompressed)
            .map_err(|e| format!("Entpacken fehlgeschlagen: {}", e))?;

        fs::write(&dest_path, &decompressed)
            .map_err(|e| format!("Datei konnte nicht gespeichert werden: {}", e))?;

        demo_entry_from_path(&dest_path)
            .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
    } else {
        // Plain .dem
        let dem_name = if clean_name.ends_with(".dem") {
            clean_name
        } else {
            format!("{}.dem", clean_name)
        };
        let dest_path = dest.join(&dem_name);
        fs::write(&dest_path, bytes.as_ref())
            .map_err(|e| format!("Datei konnte nicht gespeichert werden: {}", e))?;

        demo_entry_from_path(&dest_path)
            .ok_or_else(|| "Fehler beim Lesen der Demo.".to_string())
    }
}


