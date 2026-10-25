import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:4719/", viewport: { width: 420, height: 800 } },
  webServer: {
    command:
      "VITE_APP_VERSION=e2e-build VITE_UMAMI_WEBSITE_ID=e2e-site VITE_UMAMI_SCRIPT_URL=/e2e-tracker.js npm run build && VITE_APP_VERSION=e2e-next VITE_UMAMI_WEBSITE_ID=e2e-site VITE_UMAMI_SCRIPT_URL=/e2e-tracker.js npx vite build --outDir dist-next && node e2e/serve.mjs 4719",
    url: "http://localhost:4719/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
