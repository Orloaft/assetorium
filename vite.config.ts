import { defineConfig } from "vite";

// Asset Forge is a fully client-side app — no backend. `npm run dev` serves it
// locally; `npm run build` emits a static bundle that can be opened from disk
// or hosted anywhere.
export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5180,
    open: true
  },
  build: {
    target: "es2022",
    outDir: "dist"
  }
});
