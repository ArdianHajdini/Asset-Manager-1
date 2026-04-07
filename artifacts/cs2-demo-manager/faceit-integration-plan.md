# FACEIT Integration Plan

## Status: Architecture Complete — Credentials Required for Production

This document describes the FACEIT integration for CS2 Demo Manager:
what is already implemented, what still requires real credentials,
and what is needed for a full production release.

---

## What Is Already Implemented

### Services

| File | Description |
|---|---|
| `src/services/faceitAuthService.ts` | OAuth2 PKCE flow + API key authentication |
| `src/services/faceitMatchService.ts` | Match history, match details, player lookup |
| `src/services/faceitDownloadService.ts` | Demo URL resolution, download, extract, library registration |

### Rust Backend

| Command | Description |
|---|---|
| `download_demo(url, dest_dir, filename, auth_token)` | Downloads a demo URL via reqwest, auto-detects .gz magic bytes, extracts to .dem, saves to disk |

### UI

| Component/Page | Description |
|---|---|
| `FaceitPage.tsx` | Main page — account connection + match list |
| `MatchCard.tsx` | Per-match card — teams, result, download, watch, library link |
| `FaceitCallbackPage.tsx` | OAuth2 redirect handler (`/faceit/callback`) |
| `FaceitContext.tsx` | Global auth state, match cache, download state per match |

### Authentication Paths

The app supports two authentication methods:

#### 1. API Key (works without any app setup)
- User creates a free API key at [developers.faceit.com](https://developers.faceit.com/)
- User enters nickname + API key in the app
- App fetches match history, downloads demos using this key
- **Ready to use immediately — no additional setup required**

#### 2. OAuth2 PKCE (planned — requires CLIENT_ID)
- Full PKCE flow implemented (code_verifier, code_challenge, SHA-256)
- Auth URL: `https://accounts.faceit.com/oauth/authorize`
- Token URL: `https://accounts.faceit.com/oauth/token`
- Callback handled at `/faceit/callback`
- **Blocked until CLIENT_ID is configured — see below**

---

## What Still Requires Real FACEIT Credentials

### OAuth2 Setup

To enable the "Mit FACEIT anmelden (OAuth)" button, you need:

1. A **FACEIT Developer account** at [developers.faceit.com](https://developers.faceit.com/)
2. Create a new **App** in the developer portal
3. Set the **Redirect URI** to:
   - Development: `http://localhost:{PORT}/faceit/callback`
   - Production Tauri: a custom URL scheme (e.g. `cs2demo://auth/callback`)
4. Copy the **Client ID** and set it as an environment variable:
   ```
   VITE_FACEIT_CLIENT_ID=your-client-id-here
   ```
5. For the token exchange: FACEIT OAuth for public clients (PKCE without secret) — verify
   that FACEIT allows this. If a client secret is required, the token exchange must be
   moved to a backend proxy to avoid exposing the secret in the client.

### API Endpoint Verification

The following endpoints are used. Verify they work with your app's credentials:

| Endpoint | Used for |
|---|---|
| `GET /data/v4/players?nickname={nick}&game=cs2` | Player lookup |
| `GET /data/v4/players/{id}/history?game=cs2&limit=20` | Match history |
| `GET /data/v4/matches/{match_id}` | Match details + demo_url |

### Demo URL Availability

- FACEIT demo URLs (`demo_url` field in match data) are not available for all match types.
- Premium/ranked matches (FPL, hubs) reliably have demo URLs.
- Public queue matches may or may not have demos.
- The app gracefully shows "Keine Demo verfügbar" when demo_url is missing.

---

## Download Flow (End-to-End)

```
User clicks "Demo herunterladen"
  → FaceitPage fetches match details (demo_url field)
  → faceitDownloadService.resolveDemoUrl() extracts the URL
  → In Tauri: Rust download_demo command
      → reqwest downloads the file with optional auth token
      → Detects .gz magic bytes (0x1F 0x8B)
      → Extracts with flate2 GzDecoder → .dem file
      → Saves to configured demo folder
  → In Browser: window.open(url) triggers browser download (no auto-registration)
  → Demo registered in local library (loadDemos/saveDemos)
  → User can immediately click "In CS2 ansehen"
      → launchDemoInCS2() → Steam URI → cs2.exe → clipboard fallback
```

---

## Tauri CSP Configuration

`tauri.conf.json` now allows outbound connections to:
- `https://open.faceit.com` — FACEIT Data API
- `https://accounts.faceit.com` — FACEIT OAuth

If FACEIT demo files are hosted on S3 or CDN domains, add those to the CSP as well.

---

## What Is Needed for Production

1. **FACEIT App registration** → CLIENT_ID → set `VITE_FACEIT_CLIENT_ID`
2. **Production Redirect URI** — add to FACEIT app settings
   - For Tauri desktop: implement deep link / custom protocol handler
3. **Token refresh** — implement access token refresh using refresh_token before expiry
   (the structure is in `faceitAuthService.ts`, refresh logic needs to be added)
4. **Rate limiting** — the FACEIT API has rate limits; add exponential backoff if needed
5. **Demo URL CDN domains** — add to Tauri CSP and reqwest allowed hosts
6. **Error boundary** — wrap FaceitPage in a React error boundary for API failures
7. **Secure token storage** — in production Tauri, store tokens in the OS keychain
   instead of localStorage (use `tauri-plugin-stronghold` or similar)

---

## Development Testing Without Real Credentials

To test the UI flows without FACEIT credentials, you can:

1. Hard-code a mock response in `faceitMatchService.ts`
   (replace `faceitFetch` with a mock that returns test data)
2. Use the Replit browser preview to test the connection UI, form validation,
   and MatchCard rendering with mock data

The manual import flow (DropZone) works without any FACEIT credentials and
can be used to test the full download → library → CS2 launch pipeline.
