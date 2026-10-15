import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:4719/", viewport: { width: 420, height: 800 } },
  webServer: {
    command: "VITE_APP_VERSION=e2e-build npm run build && npm run preview -- --port 4719 --strictPort",
    url: "http://localhost:4719/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
