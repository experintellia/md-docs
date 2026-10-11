import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the built bundle — the same code that ships in the
// `.xdc` — served by `vite preview`. The messenger's webxdc.js is stood in for
// by the @webxdc/vite-plugins mock (see e2e/fixtures.ts).
//
// Projects map to the webviews the app actually runs in: Chromium for Android
// WebView / Electron desktop, WebKit for iOS WKWebView. CI runs the WebKit ones
// on macOS, whose WebKit build is the closest Playwright gets to iOS Safari.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'mobile-chrome', use: devices['Pixel 7'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
    { name: 'mobile-safari', use: devices['iPhone 15'] },
  ],
});
