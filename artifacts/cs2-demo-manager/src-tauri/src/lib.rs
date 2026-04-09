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

/// A player entry extracted from a CS2 demo file.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DemoPlayer {
    /// Steam ID 64 as a string (avoids JSON number precision loss)
    pub xuid: String,
    pub name: String,
    /// 2 = Terrorist, 3 = Counter-Terrorist, 0 = unassigned/spectator
    #[serde(rename = "teamNum")]
    pub team_num: u32,
    #[serde(rename = "isHltv")]
    pub is_hltv: bool,
    /// voice_mute slot index from the demo userinfo string table.
    /// Present when the CDemoStringTables packet was successfully parsed.
    /// Pass this value to CS2's `voice_mute <entityId>` console command.
    #[serde(rename = "entityId", skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<u32>,
}

/// PBDEMS2 magic header bytes for CS2 demo files.
const PBDEMS2_MAGIC: &[u8; 8] = b"PBDEMS2\0";
/// Bit 6 of the packet command byte signals snappy compression.
const DEM_IS_COMPRESSED_BIT: u64 = 64;

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

    /// Launch CS2 with a playdemo argument.
    ///
    /// Status values are ALWAYS "launched" or "clipboard_fallback" (English, never German).
    /// The frontend checks result.status === "launched".
    ///
    /// Windows launch order:
    ///
    ///   steam_handoff (PRIMARY)
    ///     Find steam.exe via Registry (3 keys tried in order):
    ///       1. HKLM\SOFTWARE\WOW6432Node\Valve\Steam  (standard 64-bit OS)
    ///       2. HKCU\SOFTWARE\Valve\Steam               (per-user installation)
    ///       3. HKLM\SOFTWARE\Valve\Steam               (32-bit OS / unusual)
    ///     Safety net: if all registry keys fail, derive steam.exe from cs2.exe path
    ///       (walk 7 dirs up: win64→bin→game→csgo→Counter-Strike…→steamapps→steam_root)
    ///     If steam.exe is found and spawn succeeds → status="launched", method="steam_handoff"
    ///
    ///   steam_uri (FALLBACK1)
    ///     cmd /C start "" "steam://rungame/730/+playdemo%20replays/<name>"
    ///     Mirrors the official Steam item-preview URI scheme.
    ///     → status="launched", method="steam_uri"
    ///
    ///   direct_cs2 (FALLBACK2)
    ///     Spawn cs2.exe directly with current_dir=.../game/csgo
    ///     Required so relative "replays/<name>" paths resolve correctly.
    ///     → status="launched", method="direct_cs2"
    ///
    ///   clipboard_fallback (LAST)
    ///     All methods failed → status="clipboard_fallback", method="none"
    ///     Frontend copies "playdemo replays/<name>" for manual paste.
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

            eprintln!("[CS2DM] launch_cs2 cs2_exe_path={}", cs2_exe_path);
            eprintln!("[CS2DM] launch_cs2 playdemo_arg={}", playdemo_arg);

            // ── Resolve steam.exe: try 3 registry keys, then path derivation ─
            //
            // Tried in order:
            //   Key 1: HKLM\SOFTWARE\WOW6432Node\Valve\Steam  (standard — 64-bit Windows)
            //   Key 2: HKCU\SOFTWARE\Valve\Steam               (per-user install)
            //   Key 3: HKLM\SOFTWARE\Valve\Steam               (32-bit Windows / rare)
            //   Safety net: walk 7 dirs up from cs2.exe to find steam.exe
            fn try_registry_key(root: winreg::RegKey, sub: &str) -> Option<PathBuf> {
                let key = root.open_subkey(sub).ok()?;
                let install_path: String = key.get_value("InstallPath").ok()?;
                let candidate = PathBuf::from(install_path).join("steam.exe");
                if candidate.exists() { Some(candidate) } else { None }
            }

            let steam_exe_path: Option<PathBuf> = {
                use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER};

                // Key 1 — HKLM WOW6432Node (most common on 64-bit Windows)
                let k1 = try_registry_key(
                    winreg::RegKey::predef(HKEY_LOCAL_MACHINE),
                    "SOFTWARE\\WOW6432Node\\Valve\\Steam",
                );
                eprintln!("[CS2DM] steam.exe key1 (HKLM WOW6432Node): {:?}", k1);

                // Key 2 — HKCU (per-user Steam install)
                let k2 = k1.or_else(|| try_registry_key(
                    winreg::RegKey::predef(HKEY_CURRENT_USER),
                    "SOFTWARE\\Valve\\Steam",
                ));
                eprintln!("[CS2DM] steam.exe key2 (HKCU): {:?}", k2);

                // Key 3 — HKLM without WOW6432Node (32-bit OS / rare)
                let k3 = k2.or_else(|| try_registry_key(
                    winreg::RegKey::predef(HKEY_LOCAL_MACHINE),
                    "SOFTWARE\\Valve\\Steam",
                ));
                eprintln!("[CS2DM] steam.exe key3 (HKLM native): {:?}", k3);

                // Safety net: derive from cs2.exe path (7 dirs up to Steam root)
                // cs2.exe: <steam_root>/steamapps/common/Counter-Strike…/game/bin/win64/cs2.exe
                let k4 = k3.or_else(|| {
                    let mut p = PathBuf::from(&cs2_exe_path);
                    for _ in 0..7 { p = p.parent()?.to_path_buf(); }
                    let candidate = p.join("steam.exe");
                    if candidate.exists() { Some(candidate) } else { None }
                });
                eprintln!("[CS2DM] steam.exe safety-net (path derivation): {:?}", k4);

                k4
            };

            eprintln!("[CS2DM] steam.exe final={:?}", steam_exe_path);

            // ── steam_handoff (PRIMARY) ────────────────────────────────────
            // steam.exe -applaunch 730 +playdemo replays/<name>
            // Arguments passed directly to Steam — no URI encoding, no shell parsing.
            if let Some(ref steam_exe) = steam_exe_path {
                eprintln!("[CS2DM] branch=steam_handoff trying steam_exe={}", steam_exe.display());
                let spawn_ok = Command::new(steam_exe)
                    .args(["-applaunch", "730", "+playdemo", &playdemo_arg])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .is_ok();
                eprintln!("[CS2DM] branch=steam_handoff spawn_ok={}", spawn_ok);
                if spawn_ok {
                    eprintln!("[CS2DM] status=launched method=steam_handoff");
                    return Ok(LaunchResult {
                        status: "launched".to_string(),
                        command: Some(format!(
                            "\"{}\" -applaunch 730 +playdemo \"{}\"",
                            steam_exe.display(), playdemo_arg
                        )),
                        method: Some("steam_handoff".to_string()),
                        note: Some("Steam (applaunch) gestartet. Falls Demo nicht automatisch lädt: ~ öffnen und Befehl einfügen.".to_string()),
                    });
                }
                eprintln!("[CS2DM] branch=steam_handoff FAILED — trying FALLBACK1");
            } else {
                eprintln!("[CS2DM] branch=steam_handoff SKIPPED — steam.exe not found in registry or path");
            }

            // ── steam_uri (FALLBACK1) ──────────────────────────────────────
            // cmd /C start "" "steam://rungame/730/+playdemo%20replays/<name>"
            // Mirrors the official Steam item-preview URI scheme (rungame, %20-encoded).
            let uri = format!("steam://rungame/730/+playdemo%20{}", playdemo_arg);
            let raw_cmd = format!("/C start \"\" \"{}\"", uri);
            eprintln!("[CS2DM] branch=steam_uri uri={}", uri);
            let uri_ok = Command::new("cmd")
                .raw_arg(&raw_cmd)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .is_ok();
            eprintln!("[CS2DM] branch=steam_uri spawn_ok={}", uri_ok);
            if uri_ok {
                eprintln!("[CS2DM] status=launched method=steam_uri");
                return Ok(LaunchResult {
                    status: "launched".to_string(),
                    command: Some(format!("cmd /C start \"\" \"{}\"", uri)),
                    method: Some("steam_uri".to_string()),
                    note: Some("CS2 via Steam-URI geöffnet. Falls Demo nicht startet: ~ öffnen und Befehl einfügen.".to_string()),
                });
            }
            eprintln!("[CS2DM] branch=steam_uri FAILED — trying FALLBACK2");

            // ── direct_cs2 (FALLBACK2) ────────────────────────────────────
            // Spawn cs2.exe directly. current_dir must be .../game/csgo so that
            // the relative "replays/<name>" path resolves correctly.
            let exe = PathBuf::from(&cs2_exe_path);
            eprintln!("[CS2DM] branch=direct_cs2 cs2.exe exists={}", exe.exists());
            if exe.exists() {
                // cs2.exe: .../game/bin/win64/cs2.exe → csgo dir: .../game/csgo/
                let csgo_dir = exe
                    .parent()                          // win64
                    .and_then(|p| p.parent())          // bin
                    .and_then(|p| p.parent())          // game
                    .map(|game| game.join("csgo"));
                eprintln!("[CS2DM] branch=direct_cs2 csgo_dir={:?}", csgo_dir);

                let mut cmd = Command::new(&exe);
                if let Some(ref dir) = csgo_dir {
                    if dir.exists() { cmd.current_dir(dir); }
                }
                let direct_ok = cmd
                    .args(["+playdemo", &playdemo_arg])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .is_ok();
                eprintln!("[CS2DM] branch=direct_cs2 spawn_ok={}", direct_ok);
                if direct_ok {
                    eprintln!("[CS2DM] status=launched method=direct_cs2");
                    return Ok(LaunchResult {
                        status: "launched".to_string(),
                        command: Some(console_cmd.clone()),
                        method: Some("direct_cs2".to_string()),
                        note: Some("CS2 direkt gestartet. Falls Demo nicht lädt: ~ öffnen und Befehl einfügen.".to_string()),
                    });
                }
                eprintln!("[CS2DM] branch=direct_cs2 FAILED — clipboard fallback");
            } else {
                eprintln!("[CS2DM] branch=direct_cs2 SKIPPED — cs2.exe not found at path");
            }

            // ── clipboard_fallback (LAST) ──────────────────────────────────
            eprintln!("[CS2DM] status=clipboard_fallback method=none");
            return Ok(LaunchResult {
                status: "clipboard_fallback".to_string(),
                command: Some(console_cmd),
                method: Some("none".to_string()),
                note: Some("CS2 konnte nicht automatisch geöffnet werden. Bitte manuell starten und Befehl einfügen.".to_string()),
            });
        }

        #[cfg(not(target_os = "windows"))]
        {
            eprintln!("[CS2DM] launch_cs2 non-windows playdemo_arg={}", playdemo_arg);
            let ok = Command::new("steam")
                .args(["-applaunch", "730", "+playdemo", &playdemo_arg])
                .spawn()
                .is_ok();
            eprintln!("[CS2DM] non-windows steam spawn_ok={} status={}", ok, if ok { "launched" } else { "clipboard_fallback" });
            if ok {
                return Ok(LaunchResult {
                    status: "launched".to_string(),
                    command: Some(console_cmd.clone()),
                    method: Some("steam_handoff".to_string()),
                    note: None,
                });
            }
            Ok(LaunchResult {
                status: "clipboard_fallback".to_string(),
                command: Some(console_cmd),
                method: Some("none".to_string()),
                note: Some("Nicht-Windows: CS2 manuell starten und Befehl einfügen.".to_string()),
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

    // ── Command — Downloads-Ordner scannen ───────────

    /// Scan a folder for demo files (.dem, .dem.gz, .dem.zst).
    /// Returns a DemoEntry for each found file (filename, filepath, size, modifiedAt).
    /// Unlike list_demos() which only scans .dem files, this also returns compressed demos.
    #[tauri::command]
    pub fn scan_downloads(directory: String) -> Result<Vec<DemoEntry>, String> {
        let dir = std::path::Path::new(&directory);
        if !dir.exists() {
            // Return empty instead of error — user may not have set a folder yet
            return Ok(vec![]);
        }
        if !dir.is_dir() {
            return Err(format!("Kein Ordner: {}", directory));
        }

        let mut entries = Vec::new();
        let read_dir = fs::read_dir(dir)
            .map_err(|e| format!("Ordner konnte nicht gelesen werden: {}", e))?;

        for entry in read_dir.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Match .dem, .dem.gz, .dem.zst only
            if !name.ends_with(".dem")
                && !name.ends_with(".dem.gz")
                && !name.ends_with(".dem.zst")
            {
                continue;
            }

            // Build display name by stripping all demo-related suffixes
            let display_name = {
                let s = name.as_str();
                let s = s.strip_suffix(".zst").unwrap_or(s);
                let s = s.strip_suffix(".gz").unwrap_or(s);
                let s = s.strip_suffix(".dem").unwrap_or(s);
                s.to_string()
            };

            let directory_str = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let modified_at = file_modified_iso(&path);

            entries.push(DemoEntry {
                filename: name,
                display_name,
                filepath: path.to_string_lossy().to_string(),
                directory: directory_str,
                size,
                modified_at,
            });
        }

        // Newest files first
        entries.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(entries)
    }

    // ── PBDEMS2 Demo Parser ───────────────────────────────────────────────

    /// Read a protobuf varint from `data`. Returns (value, bytes_consumed).
    fn pb_varint(data: &[u8]) -> (u64, usize) {
        let mut val = 0u64;
        let mut shift = 0u32;
        let mut n = 0usize;
        for &b in data.iter().take(10) {
            val |= ((b & 0x7f) as u64) << shift;
            shift += 7;
            n += 1;
            if b & 0x80 == 0 { break; }
        }
        (val, n)
    }

    /// A protobuf field value (only the types we actually need).
    enum PbVal {
        Varint(u64),
        Bytes(Vec<u8>),
    }

    /// Iterate all protobuf fields in `data`.
    fn pb_fields(data: &[u8]) -> Vec<(u32, PbVal)> {
        let mut pos = 0;
        let mut out = Vec::new();
        while pos < data.len() {
            let (tag, n) = pb_varint(&data[pos..]);
            if n == 0 { break; }
            pos += n;
            let field_num = (tag >> 3) as u32;
            match tag & 7 {
                0 => {
                    let (v, n) = pb_varint(&data[pos..]);
                    if n == 0 { break; }
                    pos += n;
                    out.push((field_num, PbVal::Varint(v)));
                }
                1 => { if pos + 8 > data.len() { break; } pos += 8; }
                2 => {
                    let (len, n) = pb_varint(&data[pos..]);
                    if n == 0 { break; }
                    pos += n;
                    let len = len as usize;
                    if pos + len > data.len() { break; }
                    out.push((field_num, PbVal::Bytes(data[pos..pos + len].to_vec())));
                    pos += len;
                }
                5 => { if pos + 4 > data.len() { break; } pos += 4; }
                _ => break,
            }
        }
        out
    }

    /// Parse a single CCSGameInfo_CPlayerInfo protobuf message.
    ///
    /// Field layout (CS2 public protobufs):
    ///   1: uint64  xuid         (Steam ID 64)
    ///   2: string  player_name
    ///   3: uint32  bot
    ///   4: bool    is_hltv
    ///   5: uint32  team         (2 = T, 3 = CT)
    fn parse_player_proto(data: &[u8]) -> Option<super::DemoPlayer> {
        let mut xuid: u64 = 0;
        let mut name = String::new();
        let mut team_num: u32 = 0;
        let mut is_hltv = false;
        for (f, v) in pb_fields(data) {
            match (f, v) {
                (1, PbVal::Varint(v))  => xuid = v,
                (2, PbVal::Bytes(b))   => name = String::from_utf8_lossy(&b).into_owned(),
                (3, PbVal::Varint(v))  => { if v != 0 { return None; } } // skip bots
                (4, PbVal::Varint(v))  => is_hltv = v != 0,
                (5, PbVal::Varint(v))  => team_num = v as u32,
                _ => {}
            }
        }
        // Discard HLTV observers, bots, and entries without a valid SteamID64.
        // Valid SteamID64 range starts at 76561197960265728 (0x0110000100000000).
        if is_hltv || xuid < 76_561_197_960_265_728 || name.is_empty() {
            return None;
        }
        Some(super::DemoPlayer { xuid: xuid.to_string(), name, team_num, is_hltv, entity_id: None })
    }

    // ── source2-demo entity observer — CS2 player voice-slot extraction ──────

    /// Private submodule that isolates the source2-demo proc-macro attributes
    /// (`#[observer]`, `#[uses_entities]`, `#[on_entity]`) from the rest of
    /// the commands module, avoiding name collisions with our own types.
    mod s2 {
        use source2_demo::prelude::*;

        /// Minimal per-entity record collected by the observer.
        pub struct PlayerEntry {
            /// Steam ID64 as string; empty string when not available (FACEIT).
            pub xuid: String,
            pub name: String,
            /// 2 = Terrorist, 3 = Counter-Terrorist
            pub team_num: u32,
        }

        /// Collects `CCSPlayerController` entities while the demo is parsed.
        ///
        /// Key: entity.index() (0-based) — this is the voice_mute slot number.
        pub struct Cs2SlotObserver {
            pub players: std::collections::HashMap<u32, PlayerEntry>,
        }

        impl Default for Cs2SlotObserver {
            fn default() -> Self {
                Cs2SlotObserver {
                    players: std::collections::HashMap::new(),
                }
            }
        }

        #[observer]
        #[uses_entities]
        impl Cs2SlotObserver {
            /// Called for every entity create/update event.
            /// We overwrite the map entry with the latest state — this keeps the
            /// correct team assignments after the CS2 halftime team swap.
            #[on_entity]
            fn handle_entity(
                &mut self,
                _ctx: &Context,
                entity: &Entity,
            ) -> ObserverResult {
                if entity.class().name() != "CCSPlayerController" {
                    return Ok(());
                }

                // Only track players actively on T (2) or CT (3).
                let team_num: u32 = entity
                    .get_property_by_name("m_iTeamNum")
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .unwrap_or(0);
                if team_num != 2 && team_num != 3 {
                    return Ok(());
                }

                // Player name — skip empty / spectator / GOTV entries.
                let name: String = entity
                    .get_property_by_name("m_iszPlayerName")
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .unwrap_or_default();
                if name.is_empty() {
                    return Ok(());
                }

                // Steam ID64 — may be 0 in FACEIT demos (proxy accounts).
                let steam_id: u64 = entity
                    .get_property_by_name("m_steamID")
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .unwrap_or(0);

                let xuid = if steam_id > 76_561_197_960_265_728 {
                    steam_id.to_string()
                } else {
                    String::new()
                };

                // CS2 voice slot = entity index − 1 (0-based player_slot).
                // entity.index() is the 1-based entity handle from the demo
                // stream; tv_listen_voice_indices bit N = player slot N (0-based).
                let voice_slot = entity.index().saturating_sub(1);
                self.players
                    .insert(voice_slot, PlayerEntry { xuid, name, team_num });
                Ok(())
            }
        }
    }

    /// Parse players from a CS2 demo using the source2-demo entity observer.
    ///
    /// Returns a `Vec<DemoPlayer>` where every player has:
    ///   - `entity_id`  = `entity.index()` (the 0-based voice_mute slot directly)
    ///   - `team_num`   = 2 (T) or 3 (CT) from the entity's final state
    ///   - `xuid`       = SteamID64 string (> 76_561_197_960_265_728), or ""
    ///                    for FACEIT proxy accounts / bots whose `m_steamID`
    ///                    is 0 or below the valid SteamID64 minimum.
    ///   - `name`       = display name from `m_iszPlayerName`
    ///
    /// SteamID filtering policy:
    ///   `m_steamID > 76_561_197_960_265_728` → stored as decimal string (xuid).
    ///   Values outside this range are stored as empty string rather than
    ///   being filtered out, because voice-slot assignment uses `entity_id`
    ///   directly and does NOT need a valid xuid. This means FACEIT players and
    ///   bot entries are kept in the list (they have a valid slot) but their
    ///   xuid field is empty, so own/enemy team inference using `userXuid`
    ///   matching will not match them — a deliberate conservative choice.
    ///
    /// Returns `Err` on any parse failure so the caller can fall back to the
    /// CDemoFileInfo + CDemoStringTables path.
    fn parse_players_via_source2(filepath: &str) -> Result<Vec<super::DemoPlayer>, String> {
        // DemoRunner trait provides .run_to_end(); must be in scope to call it.
        use source2_demo::DemoRunner;

        let file = fs::File::open(filepath)
            .map_err(|e| format!("source2-demo: Datei nicht geöffnet: {e}"))?;

        let mut parser = source2_demo::Parser::from_reader(file)
            .map_err(|e| format!("source2-demo: Parser-Fehler: {e}"))?;

        let collector = parser.register_observer::<s2::Cs2SlotObserver>();

        parser.run_to_end()
            .map_err(|e| format!("source2-demo: run_to_end Fehler: {e}"))?;

        // Collect results while the RefCell borrow is held, then release it.
        let players: Vec<super::DemoPlayer> = {
            let obs = collector.borrow();
            obs.players
                .iter()
                .map(|(&slot, entry)| super::DemoPlayer {
                    xuid: entry.xuid.clone(),
                    name: entry.name.clone(),
                    team_num: entry.team_num,
                    is_hltv: false,
                    entity_id: Some(slot),
                })
                .collect()
        };

        eprintln!(
            "[CS2DM] source2-demo: {} Spieler aus Entities ({} T, {} CT)",
            players.len(),
            players.iter().filter(|p| p.team_num == 2).count(),
            players.iter().filter(|p| p.team_num == 3).count()
        );

        Ok(players)
    }

    // ── Voice-slot parser (CDemoStringTables → userinfo) ──────────────────

    /// Normalize a player name for case-insensitive, whitespace-tolerant matching.
    /// Trims leading/trailing whitespace, lowercases, and collapses inner runs of
    /// whitespace to a single space — matching the behaviour specified in Task #3.
    fn normalize_name(s: &str) -> String {
        s.trim()
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Both lookup maps extracted from the CDemoStringTables "userinfo" table.
    ///
    /// Primary:  xuid_to_slot  — filled from the CCSPlayerInfo `data` field.
    ///           May be empty for FACEIT demos where GOTV bots omit Steam ID64s.
    /// Fallback: name_to_slot  — filled from the `str` key field (player name).
    ///           Duplicates are excluded; wrong assignment is worse than no assignment.
    struct UserInfoMaps {
        xuid_to_slot: std::collections::HashMap<String, u32>,
        name_to_slot: std::collections::HashMap<String, u32>,
    }

    /// Parse a CCSPlayerInfo entry from the `userinfo` string table data blob.
    ///
    /// CS2 public proto (CCSPlayerInfo):
    ///   1: uint64  xuid        (Steam ID64)
    ///   2: string  player_name
    ///   7: bool    fakeplayer  (bot)
    ///   8: bool    ishltv
    ///
    /// Returns the xuid as a string, or None for bots/HLTV/invalid entries.
    fn parse_userinfo_xuid(data: &[u8]) -> Option<String> {
        let mut xuid: u64 = 0;
        let mut is_bot = false;
        let mut is_hltv = false;
        for (f, v) in pb_fields(data) {
            match (f, v) {
                (1, PbVal::Varint(v)) => xuid = v,
                (7, PbVal::Varint(v)) => is_bot  = v != 0,
                (8, PbVal::Varint(v)) => is_hltv = v != 0,
                _ => {}
            }
        }
        if is_bot || is_hltv || xuid < 76_561_197_960_265_728 {
            return None;
        }
        Some(xuid.to_string())
    }

    /// Parse a CDemoStringTables proto body and return both lookup maps.
    ///
    /// CDemoStringTables structure (field numbers):
    ///   1: repeated table_t {
    ///     1: string  table_name
    ///     2: repeated items_t {
    ///       1: string  str   (player name key)
    ///       2: bytes   data  (CCSPlayerInfo proto — xuid may be 0 in FACEIT demos)
    ///     }
    ///   }
    ///
    /// The 0-based index of each item within the "userinfo" table is the voice slot.
    fn extract_userinfo_slots(body: &[u8]) -> UserInfoMaps {
        let mut xuid_to_slot: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        let mut name_slot_raw: Vec<(String, u32)> = Vec::new();

        'tables: for (f1, v1) in pb_fields(body) {
            if f1 != 1 { continue; }
            let PbVal::Bytes(table_bytes) = v1 else { continue };
            let table_fields = pb_fields(&table_bytes);

            // Check table_name (field 1)
            let is_userinfo = table_fields.iter().any(|(f, v)| {
                *f == 1
                    && matches!(v, PbVal::Bytes(b) if b.as_slice() == b"userinfo")
            });
            if !is_userinfo { continue; }

            // Collect items (field 2) in order — index = voice slot
            let mut slot: u32 = 0;
            for (f2, v2) in table_fields {
                if f2 != 2 { continue; }
                let PbVal::Bytes(item_bytes) = v2 else { slot += 1; continue };

                // items_t:  field 1 = str (name key)  ·  field 2 = data (CCSPlayerInfo)
                let mut item_name = String::new();
                let mut item_xuid: Option<String> = None;

                for (f3, v3) in pb_fields(&item_bytes) {
                    match (f3, v3) {
                        (1, PbVal::Bytes(b)) => {
                            item_name = String::from_utf8_lossy(&b).into_owned();
                        }
                        (2, PbVal::Bytes(player_data)) => {
                            item_xuid = parse_userinfo_xuid(&player_data);
                        }
                        _ => {}
                    }
                }

                if let Some(xuid) = item_xuid {
                    xuid_to_slot.insert(xuid, slot);
                }

                let norm = normalize_name(&item_name);
                if !norm.is_empty() {
                    name_slot_raw.push((norm, slot));
                }

                slot += 1;
            }
            break 'tables; // "userinfo" found and processed
        }

        // Build name→slot map, excluding names that appear more than once.
        // A wrong assignment (duplicate name) would be worse than no assignment.
        let mut name_count: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for (name, _) in &name_slot_raw {
            *name_count.entry(name.clone()).or_insert(0) += 1;
        }

        let mut name_to_slot: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        let mut ambiguous: Vec<String> = Vec::new();
        for (name, slot) in &name_slot_raw {
            let count = *name_count.get(name.as_str()).unwrap_or(&0);
            if count == 1 {
                name_to_slot.insert(name.clone(), *slot);
            } else if !ambiguous.contains(name) {
                ambiguous.push(name.clone());
            }
        }
        if !ambiguous.is_empty() {
            eprintln!(
                "[CS2DM] extract_userinfo_slots: {} ambiguous name(s) excluded from fallback: {:?}",
                ambiguous.len(), ambiguous
            );
        }

        UserInfoMaps { xuid_to_slot, name_to_slot }
    }

    /// Scan the demo stream for a CDemoStringTables packet (type 29) and return
    /// both lookup maps from the embedded "userinfo" string table.
    ///
    /// CDemoStringTables always appears early in the demo (signon phase),
    /// so we stop after 1 000 packets to stay fast on large files.
    fn find_voice_slots(data: &[u8]) -> UserInfoMaps {
        let empty = UserInfoMaps {
            xuid_to_slot: std::collections::HashMap::new(),
            name_to_slot: std::collections::HashMap::new(),
        };
        let mut pos = 16usize; // skip 16-byte PBDEMS2 file header
        let mut scanned = 0u32;
        while pos < data.len() && scanned < 1_000 {
            let Some((cmd, body, advance)) = read_pbdems2_packet(&data[pos..]) else { break };
            let msg_type = cmd & !super::DEM_IS_COMPRESSED_BIT;
            pos += advance;
            scanned += 1;
            if msg_type == 29 {
                let maps = extract_userinfo_slots(&body);
                eprintln!(
                    "[CS2DM] find_voice_slots: CDemoStringTables after {} pkts → {} xuid-slots, {} name-slots",
                    scanned, maps.xuid_to_slot.len(), maps.name_to_slot.len()
                );
                if !maps.xuid_to_slot.is_empty() || !maps.name_to_slot.is_empty() {
                    return maps;
                }
            }
        }
        eprintln!("[CS2DM] find_voice_slots: no slots found after {} pkts", scanned);
        empty
    }

    /// Walk CDemoFileInfo → CGameInfo.csgo → CCSGameInfo → repeated player_info.
    fn parse_file_info_proto(data: &[u8]) -> Vec<super::DemoPlayer> {
        for (f1, v1) in pb_fields(data) {
            if f1 != 4 { continue; }
            if let PbVal::Bytes(gi) = v1 {
                for (f2, v2) in pb_fields(&gi) {
                    if f2 != 4 { continue; }
                    if let PbVal::Bytes(ci) = v2 {
                        let players: Vec<_> = pb_fields(&ci)
                            .into_iter()
                            .filter(|(f, _)| *f == 4)
                            .filter_map(|(_, v)| {
                                if let PbVal::Bytes(b) = v { parse_player_proto(&b) } else { None }
                            })
                            .collect();
                        if !players.is_empty() { return players; }
                    }
                }
            }
        }
        vec![]
    }

    /// Parse a PBDEMS2 packet at position 0 of `data`.
    /// Returns (raw_cmd, body, total_bytes_consumed).
    fn read_pbdems2_packet(data: &[u8]) -> Option<(u64, Vec<u8>, usize)> {
        let (cmd, n1) = pb_varint(data);
        if n1 == 0 { return None; }
        let (_, n2) = pb_varint(&data[n1..]);
        if n2 == 0 { return None; }
        let (size, n3) = pb_varint(&data[n1 + n2..]);
        if n3 == 0 { return None; }
        let hdr = n1 + n2 + n3;
        let sz = size as usize;
        if hdr + sz > data.len() { return None; }
        let body = data[hdr..hdr + sz].to_vec();
        let is_compressed = cmd & super::DEM_IS_COMPRESSED_BIT != 0;
        let actual_body = if is_compressed {
            match snap::raw::Decoder::new().decompress_vec(&body) {
                Ok(d) => d,
                Err(_) => body,
            }
        } else {
            body
        };
        Some((cmd, actual_body, hdr + sz))
    }

    /// Parse player entries from a CS2 PBDEMS2 (.dem) file.
    ///
    /// Returns each real player's Steam ID64, display name, team number,
    /// and voice_mute slot (entityId).
    ///
    /// Primary path — source2-demo entity observer:
    ///   `entity.index()` is the 0-based voice_mute slot.  Works for both regular
    ///   and FACEIT demos.  Returns the complete player list with slots assigned.
    ///
    /// Fallback — CDemoFileInfo + CDemoStringTables:
    ///   Used only when the source2-demo parser fails or returns no players.
    ///   Step 1: CDemoFileInfo → player names/teams.
    ///   Step 2: CDemoStringTables "userinfo" → voice_mute slot lookup.
    #[tauri::command]
    pub fn parse_demo_players(filepath: String) -> Result<Vec<super::DemoPlayer>, String> {
        // ── Primary: source2-demo entity observer ─────────────────────────
        // entity.index() IS the voice slot. Returns complete player data including
        // team, xuid (where available), and entity_id in a single pass.
        match parse_players_via_source2(&filepath) {
            Ok(players) if !players.is_empty() => {
                eprintln!(
                    "[CS2DM] parse_demo_players: {} Spieler via source2-demo",
                    players.len()
                );
                return Ok(players);
            }
            Ok(_) => {
                eprintln!(
                    "[CS2DM] source2-demo: leer → CDemoFileInfo+CDemoStringTables Fallback"
                );
            }
            Err(e) => {
                eprintln!(
                    "[CS2DM] source2-demo Fehler: {} → CDemoFileInfo+CDemoStringTables Fallback",
                    e
                );
            }
        }

        // ── Fallback: CDemoFileInfo (player names/teams) + CDemoStringTables ──
        let data = fs::read(&filepath)
            .map_err(|e| format!("Demo-Datei konnte nicht gelesen werden: {e}"))?;

        if data.len() < 16 {
            return Err("Datei zu klein — keine gültige CS2-Demo.".to_string());
        }
        if &data[..8] != super::PBDEMS2_MAGIC {
            return Err("Kein gültiges CS2-Demo-Format (PBDEMS2 erwartet).".to_string());
        }

        // ── Step 1: get player names & teams from CDemoFileInfo ───────────

        // Strategy A: fileinfo_offset (bytes 8..12, little-endian i32)
        let fi_offset = i32::from_le_bytes(data[8..12].try_into().unwrap()) as usize;
        let mut players = if fi_offset > 16 && fi_offset < data.len() {
            if let Some((_, body, _)) = read_pbdems2_packet(&data[fi_offset..]) {
                let ps = parse_file_info_proto(&body);
                if !ps.is_empty() {
                    eprintln!("[CS2DM] parse_demo_players: {} players via fileinfo_offset={}", ps.len(), fi_offset);
                }
                ps
            } else { vec![] }
        } else { vec![] };

        // Strategy B (fallback): scan for DEM_FileInfo (type 4)
        if players.is_empty() {
            eprintln!("[CS2DM] parse_demo_players: fallback scan for DEM_FileInfo");
            let mut pos = 16usize;
            let mut scanned = 0u32;
            while pos < data.len() && scanned < 2_000 {
                let Some((cmd, body, advance)) = read_pbdems2_packet(&data[pos..]) else { break };
                let msg_type = cmd & !super::DEM_IS_COMPRESSED_BIT;
                pos += advance;
                scanned += 1;
                if msg_type == 4 {
                    players = parse_file_info_proto(&body);
                    if !players.is_empty() {
                        eprintln!("[CS2DM] parse_demo_players: {} players via scan ({} pkts)", players.len(), scanned);
                        break;
                    }
                }
            }
        }

        if players.is_empty() {
            eprintln!("[CS2DM] parse_demo_players: no players found");
            return Ok(vec![]);
        }

        // ── Step 2: voice slots from CDemoStringTables ────────────────────
        //
        // Merge priority:
        //   A) xuid → slot   (exact SteamID64 match)
        //   B) normalized name → slot  (fallback; skipped for ambiguous names)
        //   C) entityId left undefined (no match found)

        let maps = find_voice_slots(&data);
        eprintln!(
            "[CS2DM] voice maps: {} xuid-slots, {} unique-name-slots",
            maps.xuid_to_slot.len(), maps.name_to_slot.len()
        );

        let mut xuid_matches: u32 = 0;
        let mut name_matches: u32 = 0;
        let mut still_missing: u32 = 0;

        for player in &mut players {
            // A) xuid match
            if let Some(&slot) = maps.xuid_to_slot.get(&player.xuid) {
                player.entity_id = Some(slot);
                xuid_matches += 1;
                continue;
            }
            // B) normalized name fallback (only when name is unique in the table)
            let norm = normalize_name(&player.name);
            if let Some(&slot) = maps.name_to_slot.get(&norm) {
                player.entity_id = Some(slot);
                name_matches += 1;
                eprintln!(
                    "[CS2DM] name-fallback: \"{}\" (norm: \"{}\") → slot {}",
                    player.name, norm, slot
                );
                continue;
            }
            // C) no match
            still_missing += 1;
            eprintln!(
                "[CS2DM] no match: xuid={} name=\"{}\" norm=\"{}\"",
                player.xuid, player.name, norm
            );
        }

        eprintln!(
            "[CS2DM] merge result: {} xuid-matches, {} name-fallbacks, {} still-missing",
            xuid_matches, name_matches, still_missing
        );
        eprintln!(
            "[CS2DM] parse_demo_players: returning {} players ({} with entity_id)",
            players.len(),
            players.iter().filter(|p| p.entity_id.is_some()).count()
        );
        Ok(players)
    }

    /// Detect the Windows Downloads folder for the current user.
    /// Returns the path if found, or None if it cannot be determined.
    #[tauri::command]
    pub fn detect_downloads_folder() -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            // Primary: USERPROFILE\Downloads
            if let Ok(profile) = std::env::var("USERPROFILE") {
                let candidate = PathBuf::from(profile).join("Downloads");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            // Fallback: HOMEDRIVE + HOMEPATH + \Downloads
            if let (Ok(drive), Ok(home)) =
                (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH"))
            {
                let candidate = PathBuf::from(format!("{}{}", drive, home)).join("Downloads");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            None
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(home) = std::env::var("HOME") {
                let candidate = PathBuf::from(home).join("Downloads");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            None
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

    // ── Command — OAuth: open URL in system browser ───────────────
    //
    // Opens `url` in the user's default browser without loading it in the
    // Tauri webview. This is required for the FACEIT OAuth flow so that the
    // user's browser session / cookies are preserved and the OS can properly
    // handle the redirect back to the local callback server.

    #[tauri::command]
    pub fn open_url_externally(url: String) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            // `start "" <url>` — empty string is the window title (required)
            Command::new("cmd")
                .args(["/c", "start", "", url.as_str()])
                .spawn()
                .map_err(|e| format!("Browser konnte nicht geöffnet werden: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Browser konnte nicht geöffnet werden: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
                .arg(&url)
                .spawn()
                .map_err(|e| format!("Browser konnte nicht geöffnet werden: {}", e))?;
        }
        Ok(())
    }

    // ── Command — OAuth: local loopback callback server ───────────
    //
    // Binds a TCP listener on 127.0.0.1 with a random free port and returns
    // the port immediately. A background task waits for the OAuth redirect
    // from the system browser, parses the `code` and `state` query params,
    // sends a friendly HTML close-page to the browser, and emits a Tauri
    // event `faceit-oauth-callback` so the frontend can complete the flow.
    //
    // This avoids the need for a custom URI scheme (deep links) while still
    // handling the callback outside the Tauri webview. RFC 8252 §7.3 defines
    // this as the recommended approach for native apps.

    #[tauri::command]
    pub async fn start_oauth_listener(app: tauri::AppHandle) -> Result<u16, String> {
        use tauri::Emitter;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        // Fixed port so the redirect URI is predictable and can be registered
        // in the FACEIT developer portal as http://127.0.0.1:14523/callback
        let listener = TcpListener::bind("127.0.0.1:14523")
            .await
            .map_err(|e| format!("OAuth-Port 14523 konnte nicht gebunden werden: {}", e))?;

        let port = listener
            .local_addr()
            .map_err(|e| format!("Port konnte nicht ermittelt werden: {}", e))?
            .port();

        tokio::spawn(async move {
            // Accept exactly one connection (the browser redirect)
            let payload = match listener.accept().await {
                Err(e) => serde_json::json!({ "code": "", "state": "", "error": e.to_string() }),
                Ok((mut stream, _)) => {
                    // Read the HTTP request
                    let mut buf = vec![0u8; 8192];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);

                    // First line: GET /callback?code=...&state=... HTTP/1.1
                    let query_str = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .and_then(|path| path.split_once('?').map(|(_, q)| q.to_string()))
                        .unwrap_or_default();

                    let mut code = String::new();
                    let mut state = String::new();
                    let mut error = String::new();

                    for pair in query_str.split('&') {
                        if let Some((k, v)) = pair.split_once('=') {
                            // Minimal percent-decode: replace %XX sequences
                            let decoded = percent_decode(v);
                            match k {
                                "code" => code = decoded,
                                "state" => state = decoded,
                                "error" => error = decoded,
                                "error_description" if error.is_empty() => error = decoded,
                                _ => {}
                            }
                        }
                    }

                    // Reply to the browser so the tab shows a friendly message
                    let success = error.is_empty() && !code.is_empty();
                    let body = if success {
                        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>CS2 Demo Manager</title>\
                        <style>body{font-family:sans-serif;background:#0d1117;color:#ccc;display:flex;\
                        align-items:center;justify-content:center;min-height:100vh;margin:0}\
                        .box{text-align:center}.icon{font-size:3rem}.title{color:#FF5500;font-size:1.4rem;\
                        margin:.5rem 0}.sub{color:#888;font-size:.9rem}</style></head><body>\
                        <div class='box'><div class='icon'>✓</div>\
                        <div class='title'>Erfolgreich angemeldet!</div>\
                        <div class='sub'>Du kannst dieses Fenster jetzt schließen.</div></div>\
                        <script>setTimeout(()=>window.close(),2000)</script></body></html>"
                    } else {
                        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>CS2 Demo Manager</title>\
                        <style>body{font-family:sans-serif;background:#0d1117;color:#ccc;display:flex;\
                        align-items:center;justify-content:center;min-height:100vh;margin:0}\
                        .box{text-align:center}.icon{font-size:3rem}.title{color:#e55;font-size:1.4rem;\
                        margin:.5rem 0}.sub{color:#888;font-size:.9rem}</style></head><body>\
                        <div class='box'><div class='icon'>✗</div>\
                        <div class='title'>Anmeldung fehlgeschlagen</div>\
                        <div class='sub'>Bitte schließe dieses Fenster und versuche es erneut.</div></div>\
                        </body></html>"
                    };

                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Content-Type: text/html; charset=utf-8\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\
                         \r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.flush().await;

                    serde_json::json!({ "code": code, "state": state, "error": error })
                }
            };

            let _ = app.emit("faceit-oauth-callback", payload);
        });

        Ok(port)
    }

    /// Minimal percent-decoder: replaces `%XX` sequences and `+` → space.
    fn percent_decode(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(hi), Some(lo)) = (
                    (bytes[i + 1] as char).to_digit(16),
                    (bytes[i + 2] as char).to_digit(16),
                ) {
                    out.push((((hi << 4) | lo) as u8) as char);
                    i += 3;
                    continue;
                }
            } else if bytes[i] == b'+' {
                out.push(' ');
                i += 1;
                continue;
            }
            out.push(bytes[i] as char);
            i += 1;
        }
        out
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
            commands::scan_downloads,
            commands::detect_downloads_folder,
            commands::parse_demo_players,
            commands::open_url_externally,
            commands::start_oauth_listener,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
