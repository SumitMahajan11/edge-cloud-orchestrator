import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL   = __ENV.BASE_URL || 'http://localhost:3001';
const API_KEY    = __ENV.API_KEY  || 'test-key';
const ADMIN_KEY  = __ENV.ADMIN_KEY || 'admin-key';

const rescheduleRate = new Rate('reschedule_rate');

export const options = {
  scenarios: {
    submit_tasks: {
      executor: 'constant-vus',
      vus: 20,
      duration: '60s',
    },
  },
  thresholds: {
    'reschedule_rate': ['rate>0.90'], // 90% of affected tasks must be rescheduled
  },
};

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  // Submit a long-running task
  const res = http.post(`${BASE_URL}/v1/tasks`, JSON.stringify({
    image: 'alpine:latest',
    command: ['sleep', '30'],
    priority: 'NORMAL',
    maxRetries: 3,
    memoryMb: 128,
  }), { headers });

  if (res.status !== 201) return;
  const taskId = JSON.parse(res.body).id;

  sleep(2); // Wait for scheduling

  // Simulate node failure (admin endpoint)
  // In staging: this hits a test endpoint that marks the assigned node as offline
  const taskRes = http.get(`${BASE_URL}/v1/tasks/${taskId}`, { headers });
  if (taskRes.status !== 200) return;

  const task = JSON.parse(taskRes.body);
  if (!task.assignedNodeId) return;

  http.post(`${BASE_URL}/v1/admin/nodes/${task.assignedNodeId}/simulate-failure`, '{}', {
    headers: { ...headers, 'Authorization': `Bearer ${ADMIN_KEY}` },
  });

  // Poll for rescheduling
  let rescheduled = false;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const poll = http.get(`${BASE_URL}/v1/tasks/${taskId}`, { headers });
    if (poll.status === 200) {
      const current = JSON.parse(poll.body);
      if (current.assignedNodeId && current.assignedNodeId !== task.assignedNodeId) {
        rescheduled = true;
        break;
      }
    }
    sleep(1);
  }

  rescheduleRate.add(rescheduled ? 1 : 0);
  check(null, { 'task rescheduled after node failure': () => rescheduled });
}
