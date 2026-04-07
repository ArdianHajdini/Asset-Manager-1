# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Artifacts

### CS2 Demo Manager (`artifacts/cs2-demo-manager`)
A CS2 demo file manager and launcher — packaged as a Tauri desktop app (React + Vite frontend, Rust backend).
- **Preview path**: `/` (root) — runs in browser for development; produces a native binary when built with `pnpm tauri build`
- **Port**: assigned dynamically via `PORT` env var
- **UI language**: German throughout (all labels, errors, instructions)
- **Features**:
  - Demo library: list, search, rename, delete (file on disk in Tauri, localStorage only in browser)
  - Drag-and-drop import + native file picker (Tauri dialog plugin), HTML input fallback in browser
  - .dem and .dem.gz import (auto-extraction via Rust flate2)
  - CS2 launch: Steam URI → cs2.exe direct → clipboard+manual-steps fallback
  - Auto-detect Steam/CS2 path (Tauri only), manual path entry
  - Open demo folder in OS file manager (Tauri only)
  - Settings: demo directory, CS2/Steam paths, auto-extract toggle
- **Tauri integration**:
  - `src-tauri/src/lib.rs` — 9 Rust commands: list_demos, import_demo, delete_demo_file, rename_demo_file, open_folder, launch_cs2, check_cs2_path, detect_steam_path, get_file_info
  - `src-tauri/Cargo.toml` — dependencies: tauri 2, tauri-plugin-dialog 2, serde, flate2
  - `src-tauri/tauri.conf.json` — app metadata and window config
  - `src/services/tauriBridge.ts` — typed wrappers around `invoke()`, isTauri() detection
- **Key frontend files**:
  - `src/types/demo.ts` — TypeScript types
  - `src/services/storage.ts` — localStorage persistence (ids, custom display names)
  - `src/services/demoService.ts` — async demo management (Tauri filesystem + localStorage fallback)
  - `src/services/cs2Service.ts` — CS2/Steam launch (3-strategy fallback)
  - `src/context/AppContext.tsx` — global state with async Tauri operations
  - `src/pages/` — HomePage, LibraryPage, SettingsPage
  - `src/components/` — DemoCard, DropZone, Navbar, StatusBar
- **FACEIT integration**:
  - `src/services/faceitAuthService.ts` — OAuth2 PKCE + API key auth, token storage, PKCE helpers
  - `src/services/faceitMatchService.ts` — match history, match details, player lookup, result helpers
  - `src/services/faceitDownloadService.ts` — demo URL resolution, download, extract, library registration
  - `src/context/FaceitContext.tsx` — auth state, match cache, per-match download state
  - `src/pages/FaceitPage.tsx` — FACEIT connection screen + match list (primary page)
  - `src/pages/FaceitCallbackPage.tsx` — OAuth2 redirect callback handler (/faceit/callback)
  - `src/components/MatchCard.tsx` — per-match card with teams, result, download/watch actions
  - `faceit-integration-plan.md` — what's implemented vs what needs credentials
  - Rust `download_demo` command — downloads via reqwest, auto-detects .gz, extracts, saves to disk
  - Two auth paths: API Key (works immediately) + OAuth2 PKCE (needs VITE_FACEIT_CLIENT_ID)
- **Navigation order**: FACEIT (primary) → Bibliothek → Import → Einstellungen
- **Build for Windows**: `pnpm tauri build --target x86_64-pc-windows-msvc` on Windows/CI (not buildable on Replit Linux)

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
