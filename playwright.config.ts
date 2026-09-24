import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.FILES0_TEST_DIRECTORY ||= join(tmpdir(), `files0-browser-${createHash('sha256').update(process.cwd()).digest('hex').slice(0, 10)}`);
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  timeout: 20000, expect: { timeout: 6000 },
  use: { baseURL: 'http://127.0.0.1:3177', viewport: { width: 1280, height: 860 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && node --import tsx tests/serve.ts', url: 'http://127.0.0.1:3177', reuseExistingServer: false, timeout: 30000 }
});
