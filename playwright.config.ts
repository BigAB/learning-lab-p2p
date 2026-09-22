import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Host candidates carry the machine's LAN IP, and a desktop firewall (macOS's is on by
            // default) drops the inbound ICE checks, so only the first loopback pair per browser
            // ever connects. This switch also gathers 127.0.0.1 candidates, which never leave the
            // host. Test-harness only: the app and its SDP codec are untouched.
            "--allow-loopback-in-peer-connection",
          ],
        },
      },
    },
    {
      name: "webkit",
      testMatch: /codec\.spec\.ts|media-renegotiation\.spec\.ts/,
      // WebKit filters ICE candidates until a getUserMedia grant lands (the codec spec primes it),
      // otherwise it gathers nothing at all and there is no SDP to round-trip.
      use: { ...devices["Desktop Safari"], permissions: ["camera"] },
    },
  ],
});
