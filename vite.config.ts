/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const BASE_PATH = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base: BASE_PATH,
  appType: "mpa",
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*"],
        globIgnores: ["debug/**", "assets/debug-*.js"],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        debug: fileURLToPath(new URL("debug/index.html", import.meta.url)),
      },
    },
  },
  worker: { format: "es" },
  define: {
    APP_VERSION: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**", "**/dist/**", "**/spike/**", "**/.worktrees/**", "**/.claude/**", "**/e2e/**",
      ...(process.env.MEASURE ? [] : ["**/*.measure.test.ts"]),
    ],
  },
});
