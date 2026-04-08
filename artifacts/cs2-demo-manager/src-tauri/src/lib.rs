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
    pub method: Option<String>,
    pub note: Option<String>,
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

    /// Launch CS2 with a playdemo argument via Steam.
    ///
    /// Windows launch hierarchy:
    ///
    ///   PRIMARY  — steam.exe -applaunch 730 +playdemo replays/<name>
    ///     steam.exe path is found via Windows registry (HKLM\SOFTWARE\WOW6432Node\Valve\Steam
    ///     InstallPath), NOT derived from cs2.exe. This works even when CS2 is installed
    ///     in a secondary Steam library on a different drive (D:\SteamLibrary\...).
    ///
    ///   FALLBACK1 — cmd /C start "" "steam://rungameid/730"
    ///     Opens CS2 WITHOUT +playdemo. Steam protocol cannot reliably pass +commands.
    ///     User pastes the console command (already in clipboard).
    ///
    ///   FALLBACK2 — spawn cs2.exe directly with current_dir set to .../game/csgo
    ///     Working directory is required so relative "replays/<name>" resolves correctly.
    ///
    ///   LAST — status="clipboard_fallback"
    ///     Frontend copies "playdemo replays/<name>" for manual console paste.
    #[tauri::command]
    pub fn launch_cs2(
        cs2_exe_path: String,
        playdemo_arg: String,
    ) -> Result<LaunchResult, String> {
        let console_cmd = format!("playdemo {}", playdemo_arg);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            eprintln!("[CS2DM] launch_cs2: cs2_exe_path={}", cs2_exe_path);
            eprintln!("[CS2DM] launch_cs2: playdemo_arg={}", playdemo_arg);

            // ── Resolve steam.exe via Windows Registry ─────────────────────
            // HKLM\SOFTWARE\WOW6432Node\Valve\Steam → InstallPath
            // This finds steam.exe on the STEAM install drive (usually C:\),
            // regardless of where CS2 is installed (may be on D:\SteamLibrary).
            let steam_exe_path: Option<PathBuf> = {
                let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
                if let Ok(key) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
                    if let Ok(install_path) = key.get_value::<String, _>("InstallPath") {
                        let candidate = PathBuf::from(install_path).join("steam.exe");
                        if candidate.exists() { Some(candidate) } else { None }
                    } else { None }
                } else { None }
            };

            eprintln!("[CS2DM] steam.exe via registry: {:?}", steam_exe_path);

            // ── PRIMARY: steam.exe -applaunch 730 +playdemo replays/<name> ─
            if let Some(ref steam_exe) = steam_exe_path {
                let spawn_ok = Command::new(steam_exe)
                    .args(["-applaunch", "730", "+playdemo", &playdemo_arg])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .is_ok();
                eprintln!("[CS2DM] PRIMARY steam.exe -applaunch spawn_ok={}", spawn_ok);
                if spawn_ok {
                    return Ok(LaunchResult {
                        status: "launched".to_string(),
                        command: Some(format!(
                            "\"{}\" -applaunch 730 +playdemo \"{}\"",
                            steam_exe.display(), playdemo_arg
                        )),
                        method: Some("steam_exe_applaunch".to_string()),
                        note: Some("Steam gestartet (applaunch). Falls Demo nicht automatisch startet: Konsole öffnen und playdemo einfügen.".to_string()),
                    });
                }
            }

            // ── FALLBACK 1: steam://rungame/730/+playdemo%20replays/<name> ─
            // Format mirrors the official Steam item-preview URI scheme:
            //   steam://rungame/730/<steamid>/+command%20args
            // For playdemo no steamid is needed, so the path is:
            //   steam://rungame/730/+playdemo%20replays/<name>
            // %20 is required — a literal space splits the URI in cmd.exe.
            let uri = format!("steam://rungame/730/+playdemo%20{}", playdemo_arg);
            let raw_cmd = format!("/C start \"\" \"{}\"", uri);
            eprintln!("[CS2DM] FALLBACK1 URI: {}", uri);
            let uri_spawn_ok = Command::new("cmd")
                .raw_arg(&raw_cmd)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .is_ok();
            eprintln!("[CS2DM] FALLBACK1 uri_spawn_ok={}", uri_spawn_ok);
            if uri_spawn_ok {
                return Ok(LaunchResult {
                    status: "launched".to_string(),
                    command: Some(format!("cmd /C start \"\" \"{}\"", uri)),
                    method: Some("steam_uri_playdemo".to_string()),
                    note: Some("CS2 via Steam-URI mit +playdemo geöffnet. Falls Demo nicht startet: Konsole öffnen und Befehl einfügen.".to_string()),
                });
            }

            // ── FALLBACK 2: spawn cs2.exe directly with correct working dir ─
            // Set current_dir to .../game/csgo so relative "replays/<name>" resolves.
            let exe = PathBuf::from(&cs2_exe_path);
            eprintln!("[CS2DM] FALLBACK2 cs2.exe exists={}", exe.exists());
            if exe.exists() {
                // cs2.exe is at: .../game/bin/win64/cs2.exe
                // csgo dir is:  .../game/csgo/
                let csgo_dir = exe
                    .parent()        // win64
                    .and_then(|p| p.parent())  // bin
                    .and_then(|p| p.parent())  // game
                    .map(|game_dir| game_dir.join("csgo"));

                eprintln!("[CS2DM] FALLBACK2 csgo_dir={:?}", csgo_dir);

                let mut cmd = Command::new(&exe);
                if let Some(ref dir) = csgo_dir {
                    if dir.exists() {
                        cmd.current_dir(dir);
                    }
                }
                let direct_ok = cmd
                    .args(["+playdemo", &playdemo_arg])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .is_ok();
                eprintln!("[CS2DM] FALLBACK2 direct_ok={}", direct_ok);
                if direct_ok {
                    return Ok(LaunchResult {
                        status: "launched".to_string(),
                        command: Some(console_cmd.clone()),
                        method: Some("direct_cs2".to_string()),
                        note: Some("CS2 direkt gestartet. Falls Demo nicht startet: Konsole öffnen und playdemo einfügen.".to_string()),
                    });
                }
            }

            // ── LAST: all methods failed ───────────────────────────────────
            return Ok(LaunchResult {
                status: "clipboard_fallback".to_string(),
                command: Some(console_cmd),
                method: Some("none".to_string()),
                note: Some("Konnte CS2 nicht automatisch öffnen. Bitte manuell starten und playdemo einfügen.".to_string()),
            });
        }

        #[cfg(not(target_os = "windows"))]
        {
            let linux_ok = Command::new("steam")
                .args(["-applaunch", "730", "+playdemo", &playdemo_arg])
                .spawn()
                .is_ok();
            if linux_ok {
                return Ok(LaunchResult {
                    status: "launched".to_string(),
                    command: Some(console_cmd.clone()),
                    method: Some("steam_exe_applaunch".to_string()),
                    note: None,
                });
            }
            Ok(LaunchResult {
                status: "clipboard_fallback".to_string(),
                command: Some(console_cmd),
                method: Some("none".to_string()),
                note: Some("Nicht-Windows Platform: bitte CS2 manuell starten.".to_string()),
            })
        }
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

    /// Check whether CS2 is currently running as a process.
    ///
    /// Windows: queries tasklist for "cs2.exe"
    /// Linux:   uses pgrep -x cs2
    #[tauri::command]
    pub fn is_cs2_running() -> bool {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let output = match Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq cs2.exe", "/NH", "/FO", "CSV"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let stdout = String::from_utf8_lossy(&output.stdout);
            let running = stdout.to_lowercase().contains("cs2.exe");
            eprintln!("[CS2DM] is_cs2_running: {}", running);
            return running;
        }
        #[cfg(not(target_os = "windows"))]
        {
            let ok = Command::new("pgrep")
                .args(["-x", "cs2"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            eprintln!("[CS2DM] is_cs2_running (linux): {}", ok);
            ok
        }
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
            commands::is_cs2_running,
            commands::download_demo,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
