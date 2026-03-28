import { test, expect, Page, BrowserContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:80';

test.describe('Edge-Cloud Orchestrator - Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('should display dashboard with metrics', async ({ page }) => {
    // Wait for dashboard to load
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 10000 });

    // Check for key metrics
    await expect(page.locator('[data-testid="active-nodes"]')).toBeVisible();
    await expect(page.locator('[data-testid="pending-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="completed-tasks"]')).toBeVisible();
  });

  test('should show real-time node status', async ({ page }) => {
    await page.click('[data-testid="nodes-tab"]');
    
    await expect(page.locator('[data-testid="nodes-list"]')).toBeVisible();
    
    // Check for node cards
    const nodeCards = page.locator('[data-testid="node-card"]');
    await expect(nodeCards.first()).toBeVisible();
  });

  test('should display task queue', async ({ page }) => {
    await page.click('[data-testid="tasks-tab"]');
    
    await expect(page.locator('[data-testid="task-queue"]')).toBeVisible();
    
    // Check for task filters
    await expect(page.locator('[data-testid="task-filter-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-filter-type"]')).toBeVisible();
  });
});

test.describe('Edge-Cloud Orchestrator - Task Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('[data-testid="tasks-tab"]');
  });

  test('should create a new task', async ({ page }) => {
    await page.click('[data-testid="create-task-btn"]');
    
    // Fill task form
    await page.fill('[data-testid="task-name"]', 'E2E Test Task');
    await page.selectOption('[data-testid="task-type"]', 'IMAGE_CLASSIFICATION');
    await page.selectOption('[data-testid="task-priority"]', 'HIGH');
    await page.fill('[data-testid="task-input"]', JSON.stringify({ imageUrl: 'https://example.com/image.jpg' }));
    
    await page.click('[data-testid="submit-task-btn"]');
    
    // Verify task created
    await expect(page.locator('[data-testid="task-created-success"]')).toBeVisible({ timeout: 5000 });
  });

  test('should cancel a task', async ({ page }) => {
    // Find a pending task
    const pendingTask = page.locator('[data-testid="task-card"][data-status="PENDING"]').first();
    
    if (await pendingTask.isVisible()) {
      await pendingTask.click();
      await page.click('[data-testid="cancel-task-btn"]');
      
      // Confirm cancellation
      await page.click('[data-testid="confirm-cancel-btn"]');
      
      await expect(page.locator('[data-testid="task-cancelled-success"]')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display task details', async ({ page }) => {
    const taskCard = page.locator('[data-testid="task-card"]').first();
    await taskCard.click();
    
    await expect(page.locator('[data-testid="task-details-modal"]')).toBeVisible();
    
    // Verify task details are shown
    await expect(page.locator('[data-testid="task-id"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-node"]')).toBeVisible();
  });
});

test.describe('Edge-Cloud Orchestrator - Node Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('[data-testid="nodes-tab"]');
  });

  test('should display node list', async ({ page }) => {
    await expect(page.locator('[data-testid="nodes-list"]')).toBeVisible();
  });

  test('should show node details', async ({ page }) => {
    const nodeCard = page.locator('[data-testid="node-card"]').first();
    await nodeCard.click();
    
    await expect(page.locator('[data-testid="node-details-modal"]')).toBeVisible();
    
    // Check node metrics
    await expect(page.locator('[data-testid="node-cpu-usage"]')).toBeVisible();
    await expect(page.locator('[data-testid="node-memory-usage"]')).toBeVisible();
    await expect(page.locator('[data-testid="node-latency"]')).toBeVisible();
  });

  test('should filter nodes by region', async ({ page }) => {
    await page.selectOption('[data-testid="region-filter"]', 'us-east');
    
    const nodeCards = page.locator('[data-testid="node-card"]');
    const count = await nodeCards.count();
    
    for (let i = 0; i < count; i++) {
      const region = await nodeCards.nth(i).getAttribute('data-region');
      expect(region).toBe('us-east');
    }
  });

  test('should toggle node maintenance mode', async ({ page }) => {
    const nodeCard = page.locator('[data-testid="node-card"]').first();
    await nodeCard.click();
    
    await page.click('[data-testid="toggle-maintenance-btn"]');
    
    await expect(page.locator('[data-testid="maintenance-status"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Edge-Cloud Orchestrator - Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('[data-testid="scheduler-tab"]');
  });

  test('should display scheduler status', async ({ page }) => {
    await expect(page.locator('[data-testid="scheduler-status"]')).toBeVisible();
    
    // Check for leader indicator
    const leaderIndicator = page.locator('[data-testid="leader-indicator"]');
    await expect(leaderIndicator).toBeVisible();
  });

  test('should show scheduling metrics', async ({ page }) => {
    await expect(page.locator('[data-testid="scheduling-metrics"]')).toBeVisible();
    
    // Check for key metrics
    await expect(page.locator('[data-testid="tasks-per-second"]')).toBeVisible();
    await expect(page.locator('[data-testid="avg-scheduling-time"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-rate"]')).toBeVisible();
  });

  test('should display RAFT cluster status', async ({ page }) => {
    await page.click('[data-testid="raft-status-tab"]');
    
    await expect(page.locator('[data-testid="raft-cluster"]')).toBeVisible();
    
    // Check for RAFT nodes
    const raftNodes = page.locator('[data-testid="raft-node"]');
    await expect(raftNodes).toHaveCount(3);
  });
});

test.describe('Edge-Cloud Orchestrator - Authentication', () => {
  test('should login successfully', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Check if already logged in
    if (await page.locator('[data-testid="logout-btn"]').isVisible()) {
      await page.click('[data-testid="logout-btn"]');
      await page.waitForLoadState('networkidle');
    }
    
    await page.fill('[data-testid="email"]', 'admin@edgecloud.io');
    await page.fill('[data-testid="password"]', 'admin123');
    await page.click('[data-testid="login-btn"]');
    
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 10000 });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto(BASE_URL);
    
    await page.fill('[data-testid="email"]', 'invalid@edgecloud.io');
    await page.fill('[data-testid="password"]', 'wrongpassword');
    await page.click('[data-testid="login-btn"]');
    
    await expect(page.locator('[data-testid="login-error"]')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Login first
    await page.fill('[data-testid="email"]', 'admin@edgecloud.io');
    await page.fill('[data-testid="password"]', 'admin123');
    await page.click('[data-testid="login-btn"]');
    
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 10000 });
    
    // Logout
    await page.click('[data-testid="user-menu"]');
    await page.click('[data-testid="logout-btn"]');
    
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });
});

test.describe('Edge-Cloud Orchestrator - API Health', () => {
  test('should return healthy status', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('task service health check', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/tasks/health`);
    expect(response.ok()).toBeTruthy();
  });

  test('node service health check', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/nodes/health`);
    expect(response.ok()).toBeTruthy();
  });

  test('scheduler service health check', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/schedule/health`);
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Edge-Cloud Orchestrator - API Operations', () => {
  test('should create task via API', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/tasks`, {
      data: {
        name: 'API Test Task',
        type: 'DATA_AGGREGATION',
        priority: 'MEDIUM',
        input: { dataset: 'test-data' },
      },
    });
    
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('PENDING');
  });

  test('should list nodes via API', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/nodes`);
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('should get scheduler metrics via API', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/schedule/metrics`);
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(body.raft).toBeDefined();
  });
});
