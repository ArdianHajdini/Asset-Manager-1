# Downloads-Ordner Scan Flow

## Status

| Feature | Status |
|---|---|
| Downloads-Ordner konfigurieren (Einstellungen) | Vollständig implementiert |
| Downloads-Ordner automatisch erkennen (Rust) | Vollständig implementiert |
| Scan nach .dem / .dem.gz / .dem.zst | Vollständig implementiert |
| Extrahieren + In Replay-Ordner verschieben | Vollständig implementiert |
| Scan-Button in Startseite | Vollständig implementiert |
| Scan-Button in FACEIT-Ansicht | Vollständig implementiert |
| Scan-Button in Einstellungen | Vollständig implementiert |
| Browser-Modus | Nicht verfügbar (nur Desktop-App) |

---

## Überblick

Der Downloads-Scan scannt einen konfigurierten Ordner nach CS2-Demo-Dateien, entpackt sie bei Bedarf und kopiert sie in den CS2 Replay-Ordner, damit sie über `playdemo` in CS2 geladen werden können.

---

## Konfiguration

### Downloads-Ordner
- Standard: Windows `%USERPROFILE%\Downloads`
- Einstellbar unter: **Einstellungen → Downloads-Ordner**
- Auto-Erkennung: Über Rust `detect_downloads_folder` (liest `USERPROFILE` Umgebungsvariable)
- Manuell über „Durchsuchen"-Button wählbar

### CS2 Replay-Ordner
- Wird aus dem konfigurierten Steam-Pfad abgeleitet
- Standard: `<Steam>\steamapps\common\Counter-Strike Global Offensive\game\csgo\replays`
- Muss konfiguriert sein, damit der Scan-Prozess funktioniert

---

## Technischer Ablauf

```
1. Benutzer klickt „Downloads-Ordner scannen"
2. scanDownloadsFolder(folder) → tauriScanDownloads(folder)
   → Rust scan_downloads() Befehl:
     - Liest alle Dateien im Ordner
     - Filtert: .dem, .dem.gz, .dem.zst
     - Sortiert: neueste zuerst
     - Gibt DemoEntry[] zurück
3. processCandidates(candidates, replayFolder)
   → Für jede gefundene Datei:
     a. Prüft ob bereits in der Bibliothek (überspringt wenn ja)
     b. tauriImportDemo(filepath, replayFolder, needsExtraction)
        - .dem      → direktes Kopieren in Replay-Ordner
        - .dem.gz   → Gzip-Entpacken → .dem → Replay-Ordner
        - .dem.zst  → Zstandard-Entpacken → .dem → Replay-Ordner
     c. Fügt Demo zur lokalen Bibliothek hinzu (localStorage)
4. refreshDemos() → Bibliothek neu einlesen
5. Feedback-Meldung: X Demo(s) gespeichert / X übersprungen / X Fehler
```

---

## Dateien

| Datei | Beschreibung |
|---|---|
| `src/services/downloadsService.ts` | Frontend-Logik: scan + process |
| `src-tauri/src/lib.rs` | Rust: `scan_downloads`, `detect_downloads_folder` |
| `src/services/tauriBridge.ts` | TS-Wrapper: `tauriScanDownloads`, `tauriDetectDownloadsFolder` |
| `src/pages/SettingsPage.tsx` | Downloads-Ordner Einstellung + Scan-Button |
| `src/pages/FaceitPage.tsx` | Scan-Button im FACEIT-Header |
| `src/pages/HomePage.tsx` | Scan-Button in Schnellzugriff-Grid |

---

## Fehlermeldungen (Deutsch)

| Situation | Meldung |
|---|---|
| Downloads-Ordner nicht konfiguriert | „Kein Downloads-Ordner konfiguriert. Bitte in den Einstellungen festlegen." |
| Replay-Ordner nicht konfiguriert | „Kein CS2 Replay-Ordner konfiguriert. Bitte CS2 in den Einstellungen erkennen lassen." |
| Keine Demos gefunden | „Im Downloads-Ordner wurde keine neue Demo gefunden." |
| Demos verarbeitet | „X Demo(s) wurden im Replay-Ordner gespeichert." |
| Bereits vorhanden | „X bereits vorhanden (übersprungen)." |
