# FACEIT OAuth Setup

## Status

| Feature | Status |
|---|---|
| API Key authentication | Vollständig implementiert |
| OAuth2 PKCE flow (frontend) | Vollständig implementiert |
| OAuth2 redirect handling | Vollständig implementiert |
| OAuth Client ID | Benötigt echte FACEIT Developer-Einrichtung |

---

## Was wurde implementiert

### faceitAuthService.ts

- `startOAuthFlow()` — generiert `code_verifier` + `code_challenge` (PKCE), speichert State/Verifier in `sessionStorage`, leitet zum FACEIT Authorization Endpoint weiter
- `completeOAuthFlow(code, state)` — tauscht Authorization Code gegen Access Token ein
- `connectWithApiKey(nickname, apiKey)` — validiert API Key direkt gegen die FACEIT Data API
- `loadConnection()` / `saveConnection()` / `clearConnection()` — persistente Verbindung via `localStorage`

### FaceitCallbackPage.tsx

- Empfängt OAuth Callback (liest `?code=` und `?state=` aus der URL)
- Überprüft den State gegen `sessionStorage`
- Ruft `completeOAuthFlow()` auf und zeigt Erfolgs- oder Fehlermeldung
- Leitet nach Erfolg zu `/faceit` weiter

---

## Checkliste: Was du im FACEIT Developer Portal einrichten musst

### 1. FACEIT Developer Account
URL: https://developers.faceit.com/

### 2. Neue App erstellen
- Gehe zu „Apps" → „Create New App"
- App-Name: z. B. „CS2 Demo Manager"
- App-Typ: Desktop / Native

### 3. OAuth-Einstellungen
- **Client Type:** `public` (kein Client Secret — PKCE wird verwendet)
- **Redirect URI:** `http://localhost:1420/faceit/callback` (für Tauri Entwicklung)
  - Hinweis: Für die veröffentlichte App muss eine Custom URI Scheme wie `cs2demo://auth/callback` verwendet werden
- **Scopes:** `openid`, `profile`, `membership`

### 4. Client ID notieren
Die `Client ID` aus dem Developer Portal wird für den OAuth-Login benötigt.

### 5. Umgebungsvariable setzen
```
VITE_FACEIT_CLIENT_ID=deine-client-id-hier
```

In der Replit-Umgebung:
- Öffne Replit Secrets
- Key: `VITE_FACEIT_CLIENT_ID`
- Value: deine Client ID aus dem FACEIT Developer Portal

---

## Ohne Client ID

Ohne `VITE_FACEIT_CLIENT_ID` ist der OAuth-Login nicht verfügbar.

Die App zeigt dann einen Hinweis und ermöglicht weiterhin die Verbindung über einen **FACEIT Data API Key**:
- API Key holen: https://developers.faceit.com/ → Data API → API Keys
- API Key in der App unter „Mit API-Schlüssel verbinden" eingeben

---

## Technischer Ablauf (PKCE)

```
1. App generiert code_verifier (zufällig, 64 Bytes)
2. App generiert code_challenge = SHA-256(code_verifier) → Base64URL
3. App leitet zu FACEIT Authorization Endpoint:
   https://accounts.faceit.com/oauth/authorize
   ?client_id=DEINE_ID
   &response_type=code
   &redirect_uri=...
   &scope=openid+profile+membership
   &code_challenge=...
   &code_challenge_method=S256
   &state=RANDOM_STATE
4. Benutzer loggt sich bei FACEIT ein und bestätigt
5. FACEIT leitet zurück zu redirect_uri?code=...&state=...
6. FaceitCallbackPage.tsx empfängt code + state
7. App tauscht code gegen token:
   POST https://accounts.faceit.com/oauth/token
   { code, code_verifier, redirect_uri, grant_type: "authorization_code" }
8. Access Token wird in localStorage gespeichert
```
