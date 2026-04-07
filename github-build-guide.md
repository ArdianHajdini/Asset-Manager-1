# CS2 Demo Manager — GitHub Build Guide

This guide explains how to build the CS2 Demo Manager Windows installer using GitHub Actions,
without needing Rust or Visual Studio installed on your own machine.

---

## What the build produces

After the workflow runs you will have three downloadable files:

| File | What it is |
|---|---|
| `CS2DemoManager-portable-exe` | Single `.exe` — run it directly, no installation |
| `CS2DemoManager-installer-msi` | Windows MSI installer — installs to Program Files |
| `CS2DemoManager-installer-nsis` | NSIS installer `.exe` — same as MSI, different format |

---

## Step 1 — Push the project to GitHub

### If you have not connected Replit to GitHub yet

1. On GitHub, create a new **empty** repository (no README, no .gitignore)
2. Copy the repository URL (e.g. `https://github.com/yourname/cs2-demo-manager.git`)
3. In Replit, open the **Shell** (bottom panel) and run:

```bash
git remote add origin https://github.com/yourname/cs2-demo-manager.git
git branch -M main
git push -u origin main
```

Enter your GitHub username and a **Personal Access Token** (not your password) when prompted.
Create a token at: https://github.com/settings/tokens → Generate new token (classic) → check `repo`

### If you already have it connected

Just push any commit:

```bash
git add .
git commit -m "trigger build"
git push
```

---

## Step 2 — Trigger the workflow

The workflow runs automatically when you push to `main` and any file inside
`artifacts/cs2-demo-manager/` has changed.

To trigger it manually (without a code change):

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Click **Build CS2 Demo Manager (Windows)** in the left sidebar
4. Click the **Run workflow** button → **Run workflow**

---

## Step 3 — Wait for the build

The first build takes **15–25 minutes** because Rust compiles all dependencies from scratch.
Subsequent builds with a warm cache take **5–8 minutes**.

You can watch progress in real time:
- **Actions** tab → click the running workflow → click the **build-windows** job

---

## Step 4 — Download the installer

When the build finishes (green checkmark):

1. Click the workflow run
2. Scroll down to the **Artifacts** section
3. Click any of the three artifacts to download a `.zip`
4. Unzip → run the installer or portable `.exe` on your Windows machine

---

## If the workflow fails

### Most common causes

**`pnpm install` fails with dependency resolution error**
The `pnpm-workspace.yaml` patch step removes Linux-only platform restrictions before install.
If this step fails, check the "Patch pnpm-workspace.yaml" step output for the error.

**Rust compilation error**
This is usually a real code error. Read the error in the build log — it will point to
an exact line in `src-tauri/src/lib.rs` or `Cargo.toml`.
Fix the code and push again.

**`tauri build` fails: "could not find frontend dist"**
The Vite build step ran before `tauri build` and failed silently.
Look for errors in the `pnpm run build` phase (shown inside the Tauri build step output).

**MSI not found, only NSIS produced**
This is expected sometimes — MSI requires the WiX toolset. The NSIS installer works
identically for end users. Use the NSIS artifact.

**"No artifacts were uploaded"**
The build itself failed before producing any output. Check the full log for the first
red error line.

---

## Build artifacts retention

Artifacts are stored for **30 days** on GitHub Actions.
Download them before they expire, or tag a GitHub Release to keep them permanently:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then go to GitHub → Releases → Create a release from that tag and upload the downloaded files.

---

## Local build (alternative)

If you prefer to build on your own Windows machine, see the instructions from the
previous setup guide. The short version:

```powershell
# From the project root
pnpm install

# From artifacts/cs2-demo-manager
pnpm exec tauri build
```

Prerequisites: Visual Studio C++ Build Tools, Rust, Node.js 20, pnpm.
