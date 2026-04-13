# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Artifacts

### FACEIT easyDemo CS2 (`artifacts/cs2-demo-manager`)
A paid CS2 demo manager for FACEIT players — packaged as a Tauri desktop app (React + Vite frontend, Rust backend).
- **Product name**: FACEIT easyDemo CS2
- **Licensing**: Gumroad only (`product_id=2yW8xYHXZ3Zp4EswsRVqqA==`). Buy URL: `https://ardihajdi.gumroad.com/l/easyDemo`
- **GitHub**: ArdianHajdini/Asset-Manager-1 (branch: `main`; `stable` = clean release snapshot)
- **Preview path**: `/` (root) — runs in browser for development; produces a native binary when built with `pnpm tauri build`
- **Port**: assigned dynamically via `PORT` env var
- **i18n**: 11 languages (EN, DE, FR, ES, RU, ZH, KO, PL, PT, TR, AR)
- **Features**:
  - Demo library: list, search, rename, delete (Tauri filesystem + localStorage fallback)
  - Drag-and-drop import + native file picker; .dem and .dem.gz/.dem.zst decompression
  - Voice mode filter: copy `tv_listen_voice_indices` command for T/CT team hearing
  - CS2 launch: Steam URI → direct cs2.exe → clipboard fallback
  - Statistics: per-death fight analysis with player picker (T/CT teams), crosshair error, FOV, speed, shot-before-stop, 2D SVG fight diagram, verdict
  - Gumroad license activation + 7-day offline grace period + startup online validation
  - Auto-detect Steam/CS2 path, FACEIT demo downloads (reqwest)
- **Rust commands** (`src-tauri/src/lib.rs`):
  - `list_demos`, `import_demo`, `delete_demo_file`, `rename_demo_file`, `open_folder`
  - `launch_cs2`, `check_cs2_path`, `detect_steam_path`, `get_replay_folder`, `get_file_info`
  - `is_cs2_running`, `download_demo`, `scan_downloads`, `detect_downloads_folder`
  - `parse_demo_players` — source2-demo entity observer for voice slots
  - `parse_demo_deaths(filepath, steam_id)` — source2-demo observer for player_death events + entity positions; returns `DemoDeathEvent[]`
  - `verify_license(license_key, provider)` — Gumroad verify via reqwest
  - `validate_license_stored(license_key, instance_id, provider)` — Gumroad re-validate
- **Key license storage**: `fedcs2_license` in localStorage `{key, instanceId, validatedAt, provider:"gumroad"}`
- **Key TypeScript services**: `licenseService.ts`, `tauriBridge.ts`, `demoService.ts`, `voiceService.ts`
- **Key components**: `DemoCard.tsx` (voice mode + statistics button), `StatisticsModal.tsx` (player picker + fight analysis cards)
- **Rust parser note**: CS2 `player_death` uses `userid`/`attacker` as controller handles (mask `& 0x3FFF` for entity index), NOT `player_name`/`attacker_name`
- **Build for Windows**: `pnpm tauri build --target x86_64-pc-windows-msvc` on Windows/CI

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
