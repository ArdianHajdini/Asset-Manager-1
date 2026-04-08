use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────
//  Shared types (pub so binary can use them)
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
//  All Tauri commands live in a submodule.
//
//  REASON: #[tauri::command] at the crate root
//  generates both `#[macro_export] macro_rules! __cmd__X`
//  (crate-root export) AND `use crate::__cmd__X` (re-import)
//  in the same expansion → E0255 "defined multiple times".
//  Inside a submodule the re-import comes from the crate root
//  into a DIFFERENT module namespace → no collision.
// ─────────────────────────────────────────

pub mod commands {
    use std::fs;
    use std::io::{BufReader, Read, Write};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::UNIX_EPOCH;

    use flate2::read::GzDecoder;

    use super::{DemoEntry, LaunchResult};

    // ── Compression helpers ────────────────────────────────────────

    /// Returns true if the byte slice starts with a gzip magic header (1F 8B).
    fn is_gzip(bytes: &[u8]) -> bool {
        bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
    }

    /// Returns true if the byte slice starts with a zstandard magic header (28 B5 2F FD).
    fn is_zstd(bytes: &[u8]) -> bool {
        bytes.len() >= 4
            && bytes[0] == 0x28
            && bytes[1] == 0xB5
            && bytes[2] == 0x2F
            && bytes[3] == 0xFD
    }

    // ── Helpers ───────────────────────────────────────

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
                        let leap =
                            (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
                        let days_in_year: u64 = if leap { 366 } else { 365 };
                        if remaining_days < days_in_year {
                            break;
                        }
                        remaining_days -= days_in_year;
                        year += 1;
                    }
                    let leap =
                        (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
                    let month_days: [u64; 12] = [
                        31,
                        if leap { 29 } else { 28 },
                        31,
                        30,
                        31,
                        30,
                        31,
                        31,
                        30,
                        31,
                        30,
                        31,
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

    pub fn demo_entry_from_path(path: &Path) -> Option<DemoEntry> {
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

    // ── Commands — local file management ─────────────

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

        if src_name.ends_with(".dem.zst") && extract_gz {
            // Zstandard-compressed demo (.dem.zst → .dem)
            let dem_name = src_name[..src_name.len() - 4].to_string(); // strip .zst
            let dest_path = dest.join(&dem_name);
            let file = fs::File::open(&src)
                .map_err(|e| format!("Datei konnte nicht geöffnet werden: {}", e))?;
            let decompressed = zstd::decode_all(BufReader::new(file))
                .map_err(|e| format!("Entpacken (zstd) fehlgeschlagen: {}", e))?;
            fs::write(&dest_path, &decompressed)
                .map_err(|e| format!("Entpackte Datei konnte nicht gespeichert werden: {}", e))?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
        } else if src_name.ends_with(".dem.gz") && extract_gz {
            // Gzip-compressed demo (.dem.gz → .dem)
            let dem_name = &src_name[..src_name.len() - 3]; // strip .gz
            let dest_path = dest.join(dem_name);
            let gz_file = fs::File::open(&src)
                .map_err(|e| format!("Datei konnte nicht geöffnet werden: {}", e))?;
            let mut decoder = GzDecoder::new(BufReader::new(gz_file));
            let mut out_file = fs::File::create(&dest_path).map_err(|e| {
                format!("Zieldatei konnte nicht erstellt werden: {}", e)
            })?;
            let mut buf = Vec::new();
            decoder.read_to_end(&mut buf).map_err(|e| {
                format!("Die Demo-Datei konnte nicht entpackt werden: {}", e)
            })?;
            out_file.write_all(&buf).map_err(|e| {
                format!("Entpackte Datei konnte nicht gespeichert werden: {}", e)
            })?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
        } else if src_name.ends_with(".dem") {
            // Plain demo — copy as-is
            let dest_path = dest.join(&src_name);
            fs::copy(&src, &dest_path)
                .map_err(|e| format!("Datei konnte nicht kopiert werden: {}", e))?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der kopierten Demo.".to_string())
        } else {
            Err(format!(
                "Nicht unterstütztes Format: \"{}\". Akzeptiert werden: .dem, .dem.gz, .dem.zst",
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
    pub fn rename_demo_file(
        filepath: String,
        new_name: String,
    ) -> Result<String, String> {
        let src = PathBuf::from(&filepath);
        if !src.exists() {
            return Err(format!("Datei nicht gefunden: {}", filepath));
        }
        let parent =
            src.parent().ok_or("Übergeordnetes Verzeichnis nicht gefunden.")?;
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
            Command::new("explorer")
                .arg(&dir)
                .spawn()
                .map_err(|e| format!("Explorer konnte nicht geöffnet werden: {}", e))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("xdg-open")
                .arg(&dir)
                .spawn()
                .map_err(|e| format!("Ordner konnte nicht geöffnet werden: {}", e))?;
        }
        Ok(())
    }

    // ── Commands — CS2 launcher ───────────────────────

    /// Launch CS2 with a demo via the correct launch hierarchy:
    ///
    /// **Primary — Steam URI (Windows + Linux)**
    ///   Uses the `steam://rungame/730/0/+playdemo+<arg>` URI protocol.
    ///   On Windows this runs through `cmd /C start`, which calls ShellExecute
    ///   and hands the URI to the Steam client's registered protocol handler.
    ///   On Linux it uses `xdg-open`.
    ///   Steam starts (or focuses) and passes the +playdemo argument to CS2.
    ///
    /// **Fallback — direct cs2.exe spawn**
    ///   Only used if the Steam URI handler call itself fails (Steam not installed,
    ///   `cmd` not found, etc.).  Requires `cs2_exe_path` to exist on disk.
    ///
    /// **Clipboard fallback**
    ///   If both methods fail, returns status="clipboard_fallback" so the frontend
    ///   can copy the console command and instruct the user to paste it manually.
    #[tauri::command]
    pub fn launch_cs2(
        cs2_exe_path: String,
        // Relative playdemo argument, e.g. "replays/mydemo" (no .dem extension).
        // CS2 resolves this relative to its csgo game directory, so the demo
        // must live in <Steam>/steamapps/…/game/csgo/replays/.
        playdemo_arg: String,
    ) -> Result<LaunchResult, String> {
        let console_cmd = format!("playdemo {}", playdemo_arg);
        // steam://rungame/<appid>/<user-placeholder>/+<args>
        // App ID 730 = CS2. User placeholder "0" means "current logged-in user".
        let steam_uri = format!("steam://rungame/730/0/+playdemo+{}", playdemo_arg);

        // ── Primary: Steam URI ─────────────────────────────────────────────
        #[cfg(target_os = "windows")]
        {
            // `cmd /C start "" "steam://..."` hands the URI to ShellExecute,
            // which invokes the Steam URI handler registered in the Windows registry.
            // The empty string second arg is the window title (required by `start`
            // when the first arg is a quoted URI so `start` doesn't misparse it).
            let steam_ok = Command::new("cmd")
                .args(["/C", "start", "", &steam_uri])
                .spawn()
                .is_ok();

            if steam_ok {
                return Ok(LaunchResult {
                    status: "gestartet".to_string(),
                    command: Some(console_cmd),
                });
            }

            // ── Fallback: direct cs2.exe ───────────────────────────────────
            let exe = PathBuf::from(&cs2_exe_path);
            if exe.exists() {
                let direct_ok = Command::new(&exe)
                    .arg("+playdemo")
                    .arg(&playdemo_arg)
                    .spawn()
                    .is_ok();
                if direct_ok {
                    return Ok(LaunchResult {
                        status: "gestartet".to_string(),
                        command: Some(console_cmd),
                    });
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let steam_ok = Command::new("xdg-open").arg(&steam_uri).spawn().is_ok();
            if steam_ok {
                return Ok(LaunchResult {
                    status: "gestartet".to_string(),
                    command: Some(console_cmd),
                });
            }
        }

        #[cfg(target_os = "macos")]
        {
            let steam_ok = Command::new("open").arg(&steam_uri).spawn().is_ok();
            if steam_ok {
                return Ok(LaunchResult {
                    status: "gestartet".to_string(),
                    command: Some(console_cmd),
                });
            }
        }

        // ── Both methods failed — clipboard fallback ───────────────────────
        Ok(LaunchResult {
            status: "clipboard_fallback".to_string(),
            command: Some(console_cmd),
        })
    }

    /// Create (if needed) and return the CS2 replay folder path.
    /// <steam_path>/steamapps/common/Counter-Strike Global Offensive/game/csgo/replays
    #[tauri::command]
    pub fn get_replay_folder(steam_path: String) -> Result<String, String> {
        let folder = PathBuf::from(&steam_path)
            .join("steamapps")
            .join("common")
            .join("Counter-Strike Global Offensive")
            .join("game")
            .join("csgo")
            .join("replays");
        fs::create_dir_all(&folder).map_err(|e| {
            format!("CS2 Replay-Ordner konnte nicht erstellt werden: {}", e)
        })?;
        Ok(folder.to_string_lossy().to_string())
    }

    #[tauri::command]
    pub fn check_cs2_path(cs2_path: String) -> bool {
        PathBuf::from(&cs2_path).exists()
    }

    /// Returns the Steam root installation directory (e.g. C:\Program Files (x86)\Steam).
    /// Returns None when Steam or CS2 cannot be found.
    #[tauri::command]
    pub fn detect_steam_path() -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
            if let Ok(key) =
                hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
            {
                if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                    let cs2 = PathBuf::from(&path)
                        .join("steamapps")
                        .join("common")
                        .join("Counter-Strike Global Offensive")
                        .join("game")
                        .join("bin")
                        .join("win64")
                        .join("cs2.exe");
                    if cs2.exists() {
                        // Return the Steam ROOT, not the cs2.exe path.
                        // The frontend derives cs2.exe and the replays folder from this.
                        return Some(path);
                    }
                }
            }
            None
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    }

    #[tauri::command]
    pub fn get_file_info(filepath: String) -> Result<DemoEntry, String> {
        let path = PathBuf::from(&filepath);
        demo_entry_from_path(&path)
            .ok_or_else(|| format!("Datei nicht gefunden: {}", filepath))
    }

    // ── Command — FACEIT demo download ───────────────

    #[tauri::command]
    pub async fn download_demo(
        url: String,
        dest_dir: String,
        filename: String,
        auth_token: Option<String>,
    ) -> Result<DemoEntry, String> {
        let dest = PathBuf::from(&dest_dir);
        fs::create_dir_all(&dest)
            .map_err(|e| format!("Zielordner konnte nicht erstellt werden: {}", e))?;

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

        let clean_name: String = filename
            .split('?')
            .next()
            .unwrap_or(&filename)
            .to_string();

        let raw = bytes.as_ref();
        let detect_zstd = is_zstd(raw)
            || clean_name.ends_with(".dem.zst")
            || clean_name.ends_with(".zst");
        let detect_gzip = !detect_zstd
            && (is_gzip(raw)
                || clean_name.ends_with(".dem.gz")
                || clean_name.ends_with(".gz"));

        if detect_zstd {
            // ── Zstandard (.dem.zst → .dem) ──────────────────────────────
            let dem_name = if clean_name.ends_with(".dem.zst") {
                clean_name[..clean_name.len() - 8].to_string() + ".dem"
            } else if clean_name.ends_with(".zst") {
                clean_name[..clean_name.len() - 4].to_string()
            } else {
                format!("{}.dem", clean_name)
            };
            let dest_path = dest.join(&dem_name);
            let cursor = std::io::Cursor::new(raw);
            let decompressed = zstd::decode_all(cursor)
                .map_err(|e| format!("Entpacken (zstd) fehlgeschlagen: {}", e))?;
            fs::write(&dest_path, &decompressed).map_err(|e| {
                format!("Datei konnte nicht gespeichert werden: {}", e)
            })?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
        } else if detect_gzip {
            // ── Gzip (.dem.gz → .dem) ─────────────────────────────────────
            let dem_name = if clean_name.ends_with(".dem.gz") {
                clean_name[..clean_name.len() - 7].to_string() + ".dem"
            } else if clean_name.ends_with(".gz") {
                clean_name[..clean_name.len() - 3].to_string()
            } else {
                format!("{}.dem", clean_name)
            };
            let dest_path = dest.join(&dem_name);
            let cursor = std::io::Cursor::new(raw);
            let mut decoder = GzDecoder::new(cursor);
            let mut decompressed = Vec::new();
            decoder.read_to_end(&mut decompressed).map_err(|e| {
                format!("Entpacken (gzip) fehlgeschlagen: {}", e)
            })?;
            fs::write(&dest_path, &decompressed).map_err(|e| {
                format!("Datei konnte nicht gespeichert werden: {}", e)
            })?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der entpackten Demo.".to_string())
        } else {
            // ── Plain .dem ────────────────────────────────────────────────
            let dem_name = if clean_name.ends_with(".dem") {
                clean_name
            } else {
                format!("{}.dem", clean_name)
            };
            let dest_path = dest.join(&dem_name);
            fs::write(&dest_path, raw).map_err(|e| {
                format!("Datei konnte nicht gespeichert werden: {}", e)
            })?;
            demo_entry_from_path(&dest_path)
                .ok_or_else(|| "Fehler beim Lesen der Demo.".to_string())
        }
    }
}

// ─────────────────────────────────────────
//  App entry point
// ─────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_demos,
            commands::import_demo,
            commands::delete_demo_file,
            commands::rename_demo_file,
            commands::open_folder,
            commands::launch_cs2,
            commands::get_replay_folder,
            commands::check_cs2_path,
            commands::detect_steam_path,
            commands::get_file_info,
            commands::download_demo,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
