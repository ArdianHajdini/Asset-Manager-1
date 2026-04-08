# Voice Command Flow

## Status

| Modus | Status | Technische Grundlage |
|---|---|---|
| Kein Voice | Vollständig implementiert | `voice_enable 0` |
| Alle hören | Vollständig implementiert | `voice_enable 1` |
| Eigenes Team hören | Nur Struktur, Placeholder | Benötigt Demo-Parsing |
| Gegner hören | Nur Struktur, Placeholder | Benötigt Demo-Parsing |

---

## Überblick

Bevor der Befehl kopiert wird, kann der Benutzer einen Voice-Modus wählen. Dieser wird dem `playdemo`-Befehl vorangestellt, sodass CS2 beim Demo-Start automatisch die Voice-Einstellungen anpasst.

---

## Implementierung

### voiceService.ts

```typescript
buildVoiceCommands(mode: VoiceMode): string
// "none"     → "voice_enable 0"
// "all"      → "voice_enable 1"
// "own_team" → "voice_enable 1"  (Placeholder bis Demo-Parsing verfügbar)
// "enemy"    → "voice_enable 1"  (Placeholder bis Demo-Parsing verfügbar)

buildFullPlayCommand(playdemoArg: string, voiceMode: VoiceMode): string
// Beispiel: "voice_enable 1; playdemo replays/match_de_dust2"
```

---

## Erzeugter Befehl

### Alle hören (Standard)
```
voice_enable 1; playdemo replays/mein_match
```

### Kein Voice
```
voice_enable 0; playdemo replays/mein_match
```

### Eigenes Team / Gegner (Placeholder)
```
voice_enable 1; playdemo replays/mein_match
```
*Bis Demo-Parsing implementiert ist, verhält sich dieser Modus wie „Alle hören".*

---

## UI-Integration

### DemoCard (Bibliothek)

- 4 kompakte Buttons über dem Befehlsfeld: Alle hören / Kein Voice / Eigenes Team / Gegner
- Ausgewählter Modus wird orange hervorgehoben
- Nicht vollständig implementierte Modi zeigen einen gelben Indikator-Punkt
- Tooltip zeigt Hinweis bei Placeholder-Modi
- Der angezeigte Befehl aktualisiert sich live je nach Auswahl

### MatchCard (FACEIT-Ansicht)

- Voice-Picker erscheint nach Klick auf das Lautsprecher-Icon
- Nur verfügbar wenn die Demo bereits heruntergeladen wurde
- Gleiche 4 Optionen wie in DemoCard

---

## Geplante Erweiterung: Eigenes Team / Gegner

Für eine echte Implementierung dieser Modi wird benötigt:

1. **Demo-Parser**: Liest den .dem-Datei-Header aus
2. **Team-Roster**: Ordnet SteamIDs den Teams zu (faction1 / faction2)
3. **Voice-Befehle per Spieler**: CS2 hat keine direkten `voice_mute_team` Befehle, deshalb müsste `voice_mute <steamid>` für jeden Gegner-/Teammitspieler gesendet werden
4. **Eigene Team-Erkennung**: Abgleich der SteamID des Benutzers mit den Team-Rostervn

### Placeholder-Architektur

```typescript
// voiceService.ts
case "own_team":
  // TODO: use voice_mute per player after demo parsing
  // Needed: steamId, faction1/faction2 rosters from demo header
  return "voice_enable 1"; // safe fallback

case "enemy":
  // TODO: use voice_mute per player after demo parsing
  return "voice_enable 1"; // safe fallback
```

Die Architektur ist so aufgebaut, dass die Implementierung in `voiceService.ts` ergänzt werden kann, sobald ein Demo-Parser verfügbar ist.

---

## Dateien

| Datei | Beschreibung |
|---|---|
| `src/services/voiceService.ts` | VoiceMode-Typen, buildVoiceCommands, buildFullPlayCommand |
| `src/components/DemoCard.tsx` | Voice-Picker UI, Integration in Befehls-Preview |
| `src/components/MatchCard.tsx` | Voice-Picker UI (ausklappbar nach Demo-Download) |
