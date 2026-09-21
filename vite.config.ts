import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const spaFallback = (): Plugin => ({
  name: "spa-404-fallback",
  closeBundle() {
    const dist = fileURLToPath(new URL("./dist/", import.meta.url));
    try {
      copyFileSync(`${dist}index.html`, `${dist}404.html`);
    } catch {
      /* dev server: no dist */
    }
  },
});

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), spaFallback()],
  server: { port: 5173, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? "dev") },
});
