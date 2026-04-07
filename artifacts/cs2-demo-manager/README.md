# CS2 Demo Manager

Ein benutzerfreundlicher lokaler Demo-Viewer und -Manager für Counter-Strike 2.

## Was ist das?

CS2 Demo Manager ist eine Web-App (für Desktop-Nutzung konzipiert), mit der du deine CS2-Demo-Dateien (.dem und .dem.gz) bequem verwalten und mit einem Klick in CS2 starten kannst.

**Keine Online-Funktionen, kein Login, keine Cloud** – alles läuft lokal in deinem Browser.

## Funktionen

- **Demo-Import**: .dem und .dem.gz Dateien importieren (Drag & Drop oder Dateiauswahl)
- **Demo-Bibliothek**: Alle importierten Demos auf einen Blick – mit Dateiname, Größe, Datum und Speicherort
- **Suche**: Demos nach Namen filtern
- **Umbenennen**: Anzeigenamen von Demos anpassen
- **In CS2 öffnen**: Demo mit einem Klick über Steam URI starten
- **Fallback**: Falls der Start nicht klappt – playdemo-Befehl wird automatisch in die Zwischenablage kopiert, mit Schritt-für-Schritt-Anleitung
- **Einstellungen**: Demo-Ordner, CS2-Pfad, Steam-Pfad und Optionen konfigurieren
- **Fehlermeldungen auf Deutsch**

## Lokaler Start (Entwicklung)

### Voraussetzungen

- Node.js 18+
- pnpm

### Installation

```bash
# Im Projektordner (Monorepo-Root)
pnpm install
```

### App starten

```bash
pnpm --filter @workspace/cs2-demo-manager run dev
```

Die App ist dann unter `http://localhost:PORT` erreichbar.

## Erste Schritte

1. **CS2-Pfad einrichten**: Klicke auf „Einstellungen" und trage den Pfad zu deiner `cs2.exe` ein.
   - Typischer Pfad: `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe`
2. **Demo importieren**: Auf der Startseite eine .dem oder .dem.gz Datei per Drag & Drop oder Klick importieren.
3. **Demo starten**: In der Bibliothek auf „In CS2 öffnen" klicken.

## Technologie-Stack

- **React + TypeScript** – UI-Framework
- **Vite** – Build-Tool
- **Tailwind CSS** – Styling
- **Wouter** – Client-seitiges Routing
- **localStorage** – Lokale Datenspeicherung (kein Backend benötigt)

## Desktop-App-Integration (Tauri/Electron)

Die App ist bewusst so strukturiert, dass die plattformspezifischen Teile leicht ersetzt werden können:

- `src/services/cs2Service.ts` → Hier die echte Startlogik (Shell-Aufruf) einbauen
- `src/services/demoService.ts` → Hier echte Dateisystem-Operationen ergänzen
- Suche nach Kommentaren mit `// In Tauri/Electron context` für die Einstiegspunkte

## Ordnerstruktur

```
src/
├── types/          # TypeScript-Typen
├── services/       # Logik (Demo, CS2, Storage)
├── context/        # React Context (globaler App-Zustand)
├── components/     # Wiederverwendbare UI-Komponenten
├── pages/          # Seiten (Home, Bibliothek, Einstellungen)
└── App.tsx         # Router und Provider
```
