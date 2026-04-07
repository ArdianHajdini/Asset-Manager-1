import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// On Replit: PORT and BASE_PATH are injected by the platform.
// On a local Windows machine: use standard Tauri dev defaults.
const isReplit = !!process.env.REPL_ID;

const port = process.env.PORT
  ? Number(process.env.PORT)
  : 1420; // Standard Tauri dev port

const basePath = process.env.BASE_PATH ?? "/";

const replitPlugins = isReplit
  ? [
      ...(process.env.NODE_ENV !== "production"
        ? [
            (await import("@replit/vite-plugin-runtime-error-modal")).default(),
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ]
  : [];

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
