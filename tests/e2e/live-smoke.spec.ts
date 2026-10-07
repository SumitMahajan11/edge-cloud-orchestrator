import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SMOKE_EMAIL = process.env.SMOKE_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD;

if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
  throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD environment variables are required. Please set them before running the live smoke test.');
}

interface ApiCallLog {
  page: string;
  method: string;
  url: string;
  status: number;
  itemCount?: number;
  hasData?: boolean;
}

type PageState = 'LIVE-DATA' | 'RENDERED' | 'EMPTY';

interface PageResult {
  name: string;
  url: string;
  httpStatus: number | string;
  state: PageState;
  consoleErrors: string[];
  failedRequests: string[];
  notes: string;
  screenshotPath: string;
  apiCalls: ApiCallLog[];
}

const BASE_URL = process.env.LIVE_URL || 'https://edge-cloud-orchestrator-web-swart.vercel.app';

const PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Edge Nodes', path: '/nodes' },
  { name: 'Scheduler', path: '/scheduler' },
  { name: 'Monitoring', path: '/monitoring' },
  { name: 'ML Intelligence', path: '/ml-intelligence' },
  { name: 'Policies', path: '/policies' },
  { name: 'Workflows', path: '/workflows' },
  { name: 'Webhooks', path: '/webhooks' },
];

test.describe('Live Production Smoke & Integrity Test', () => {
  test.setTimeout(180000);

  test('Audit all 8 pages on live deployment reporting RENDERED vs LIVE-DATA vs EMPTY', async ({ page }) => {
    const screenshotDir = path.resolve(process.cwd(), 'tests', 'e2e', 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const results: PageResult[] = [];
    let wsUrl = 'None';
    let wsFramesReceived = 0;
    let wsFramesSent = 0;

    page.on('websocket', (ws) => {
      wsUrl = ws.url();
      ws.on('framereceived', () => {
        wsFramesReceived++;
      });
      ws.on('framesent', () => {
        wsFramesSent++;
      });
    });

    // 1. Initial Authentication Step
    console.log(`\n[Auth] Navigating to ${BASE_URL}/login...`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    
    await page.fill('input[type="email"]', SMOKE_EMAIL);
    await page.fill('input[type="password"]', SMOKE_PASSWORD);
    await page.click('button[type="submit"]');

    // Confirm navigation away from /login
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    console.log('[Auth] Successfully authenticated session.');

    // 2. Audit each page individually
    for (const p of PAGES) {
      const targetUrl = `${BASE_URL}${p.path}`;
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      const pageApiCalls: ApiCallLog[] = [];
      let httpStatus: number | string = 'N/A';

      const onConsole = (msg: any) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      };
      const onPageError = (err: Error) => {
        consoleErrors.push(err.message);
      };
      const onResponse = async (res: any) => {
        const u = res.url();
        if (res.status() >= 400) {
          failedRequests.push(`${u} [${res.status()}]`);
        }
        if (u.includes('onrender.com') || u.includes('/v2/')) {
          let itemCount: number | undefined;
          let hasData: boolean | undefined;
          try {
            const body = await res.json();
            if (Array.isArray(body)) {
              itemCount = body.length;
              hasData = body.length > 0;
            } else if (body && typeof body === 'object') {
              if (Array.isArray(body.data)) {
                itemCount = body.data.length;
                hasData = body.data.length > 0;
              } else if (Array.isArray(body.items)) {
                itemCount = body.items.length;
                hasData = body.items.length > 0;
              } else if (Array.isArray(body.nodes)) {
                itemCount = body.nodes.length;
                hasData = body.nodes.length > 0;
              } else if (body.data && typeof body.data === 'object') {
                hasData = Object.keys(body.data).length > 0;
              } else {
                hasData = Object.keys(body).length > 0;
              }
            }
          } catch {
            // non-json
          }
          pageApiCalls.push({
            page: p.name,
            method: res.request().method(),
            url: u,
            status: res.status(),
            itemCount,
            hasData,
          });
        }
      };
      const onRequestFailed = (req: any) => {
        failedRequests.push(`${req.url()} [${req.failure()?.errorText || 'FAILED'}]`);
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);
      page.on('requestfailed', onRequestFailed);

      try {
        const response = await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        httpStatus = response ? response.status() : 'No Response';
      } catch (err: any) {
        httpStatus = `ERR: ${err.message}`;
      }

      await page.waitForTimeout(4000);

      const filename = `${p.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      const screenshotPath = path.join(screenshotDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      let state: PageState = 'EMPTY';
      let notes = '';

      if (p.name === 'Dashboard') {
        const statElements = await page.locator('.card-brief p.font-mono, [class*="StatCard"] p').allTextContents();
        const statValues = statElements.map(s => s.trim());
        const nonZeroStats = statValues.filter(s => {
          const num = parseInt(s.replace(/\D/g, ''), 10);
          return !isNaN(num) && num > 0;
        });
        
        if (nonZeroStats.length > 0) {
          state = 'LIVE-DATA';
          notes = `Non-zero stat values found: [${nonZeroStats.join(', ')}]`;
        } else if (statValues.length > 0) {
          state = 'EMPTY';
          notes = `All dashboard stat metrics are 0`;
        } else {
          state = 'RENDERED';
          notes = `Dashboard layout rendered without stat cards`;
        }
      } else if (p.name === 'Edge Nodes') {
        const rowCount = await page.locator('tbody tr').count();
        const badgeTexts = await page.locator('tbody tr td span').allTextContents();
        const statusBadges = badgeTexts.map(t => t.trim()).filter(t => /ONLINE|OFFLINE|DEGRADED|DRAINING/i.test(t));
        
        if (rowCount > 0 && statusBadges.length > 0) {
          state = 'LIVE-DATA';
          notes = `Rendered ${rowCount} nodes; first status badge="${statusBadges[0]}"`;
        } else {
          state = 'EMPTY';
          notes = `No node rows present in table`;
        }
      } else if (p.name === 'Scheduler') {
        const rowCount = await page.locator('tbody tr').count();
        const emptyStateText = await page.locator('text=No active tasks in the queue.').count();
        
        if (rowCount > 0 && emptyStateText === 0) {
          state = 'LIVE-DATA';
          notes = `Rendered ${rowCount} task rows`;
        } else {
          state = 'EMPTY';
          notes = `Explicit empty state: "No active tasks in the queue."`;
        }
      } else if (p.name === 'Monitoring') {
        const hasMetricsCalls = pageApiCalls.some(c => c.url.includes('/metrics') || c.url.includes('/carbon'));
        const chartsCount = await page.locator('canvas, svg.recharts-surface, [class*="chart"]').count();
        
        if (hasMetricsCalls && chartsCount > 0) {
          state = 'LIVE-DATA';
          notes = `${chartsCount} chart elements loaded with telemetry streams`;
        } else if (chartsCount > 0) {
          state = 'RENDERED';
          notes = `${chartsCount} charts rendered without backend telemetry`;
        } else {
          state = 'EMPTY';
          notes = `No telemetry charts found`;
        }
      } else if (p.name === 'ML Intelligence') {
        const modelApi = pageApiCalls.find(c => c.url.includes('/ml/model/current'));
        const driftApi = pageApiCalls.find(c => c.url.includes('/ml/drift'));
        const hasModel = modelApi && modelApi.hasData;
        const hasDrift = driftApi && (driftApi.itemCount ?? 0) > 0;

        if (hasModel || hasDrift) {
          state = 'LIVE-DATA';
          notes = `Active ML drift history data items=${driftApi?.itemCount ?? 0}, currentModel=${hasModel ? 'present' : 'none'}`;
        } else {
          state = 'EMPTY';
          notes = `/v2/ml/model/current returned empty payload and no model artifacts`;
        }
      } else if (p.name === 'Policies') {
        const policiesApi = pageApiCalls.find(c => c.url.includes('/scheduling/policies'));
        const count = policiesApi?.itemCount ?? 0;
        if (count > 0) {
          state = 'LIVE-DATA';
          notes = `Loaded ${count} active scheduling policies`;
        } else {
          state = 'EMPTY';
          notes = `No active scheduling policies returned`;
        }
      } else if (p.name === 'Workflows') {
        const workflowsApi = pageApiCalls.find(c => c.url.includes('/v2/workflows'));
        const count = workflowsApi?.itemCount ?? 0;
        if (count > 0) {
          state = 'LIVE-DATA';
          notes = `Loaded ${count} workflow definitions`;
        } else {
          state = 'EMPTY';
          notes = `No workflow definitions returned`;
        }
      } else if (p.name === 'Webhooks') {
        const webhooksApi = pageApiCalls.find(c => c.url.includes('/v2/webhooks/'));
        const count = webhooksApi?.itemCount ?? 0;
        if (count > 0) {
          state = 'LIVE-DATA';
          notes = `Loaded ${count} configured webhook endpoints`;
        } else {
          state = 'EMPTY';
          notes = `No webhook endpoints configured`;
        }
      }

      expect(consoleErrors).toHaveLength(0);
      expect(failedRequests).toHaveLength(0);

      results.push({
        name: p.name,
        url: targetUrl,
        httpStatus,
        state,
        consoleErrors: [...consoleErrors],
        failedRequests: [...failedRequests],
        notes,
        screenshotPath,
        apiCalls: pageApiCalls,
      });

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }

    // Print Report Table
    console.log('\n================ LIVE DEPLOYMENT INTEGRITY REPORT ================');
    console.log(`Audited Base URL: ${BASE_URL}`);
    console.log(`WebSocket Endpoint: ${wsUrl} | Frames Received: ${wsFramesReceived} | Frames Sent: ${wsFramesSent}\n`);
    console.log('| Page | HTTP Status | State | Console Errors | Failed Requests | Asserted Notes |');
    console.log('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const r of results) {
      const errCount = r.consoleErrors.length > 0 ? `${r.consoleErrors.length} errors` : '0';
      const failCount = r.failedRequests.length > 0 ? `${r.failedRequests.length} failed` : '0';
      console.log(`| ${r.name} | ${r.httpStatus} | ${r.state} | ${errCount} | ${failCount} | ${r.notes} |`);
    }
    console.log('==================================================================\n');
  });
});
