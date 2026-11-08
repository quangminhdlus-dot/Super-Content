import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cloud",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4175/super-content/",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command:
      "VITE_SUPABASE_URL=https://content-test.supabase.co VITE_SUPABASE_ANON_KEY=test-public-key npm run dev -- --port 4175 --base /super-content/",
    url: "http://127.0.0.1:4175/super-content/",
  },
});
