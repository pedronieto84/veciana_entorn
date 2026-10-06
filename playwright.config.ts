import { defineConfig } from '@playwright/test';
import 'dotenv/config';
export default defineConfig({
  testDir: './tests', testMatch: 'explorer.spec.ts', fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: `http://localhost:${process.env.WEB_PORT || 8088}`, channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'edge-desktop', use: { viewport: { width: 1440, height: 960 } } }, { name: 'edge-mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  reporter: 'list'
});