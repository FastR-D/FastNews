import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'private',
      testMatch: 'private.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4191' },
    },
    {
      name: 'desktop',
      testMatch: 'workspace.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4189',
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile',
      testMatch: 'workspace.spec.ts',
      use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:4189' },
    },
    {
      name: 'subpath',
      testMatch: 'workspace.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4190/news/',
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: 'FASTNEWS_TEST_REQUIRE_LOGIN=true ../scripts/test-server.sh 4191',
      url: 'http://127.0.0.1:4191/api/health',
      reuseExistingServer: false,
    },
    {
      command: '../scripts/test-server.sh 4189',
      url: 'http://127.0.0.1:4189/api/health',
      reuseExistingServer: false,
    },
    {
      command: '../scripts/test-server.sh 4190 /news web/dist-news',
      url: 'http://127.0.0.1:4190/api/health',
      reuseExistingServer: false,
    },
  ],
})
