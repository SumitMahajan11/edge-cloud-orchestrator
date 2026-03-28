/**
 * Load Testing Script for Edge Cloud Orchestrator
 * Uses k6 for load testing (https://k6.io/)
 * 
 * Run with: k6 run load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '2m', target: 100 },  // Stay at 100 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.05'],   // Error rate under 5%
  },
};

const BASE_URL = 'http://localhost:4001'; // Edge agent URL

// Task types to test
const taskTypes = [
  {
    name: 'image-classification',
    image: 'edgecloud-image-classifier',
  },
  {
    name: 'data-aggregation',
    image: 'edgecloud-data-aggregator',
  },
  {
    name: 'log-analysis',
    image: 'edgecloud-log-analyzer',
  },
];

export default function () {
  // Random task type
  const task = taskTypes[Math.floor(Math.random() * taskTypes.length)];
  
  // Submit task
  const payload = JSON.stringify({
    taskId: `load-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    taskName: `Load Test ${task.name}`,
    image: task.image,
    resources: {
      memory: '256m',
      cpu: '0.5',
    },
  });

  const headers = {
    'Content-Type': 'application/json',
  };

  const response = http.post(`${BASE_URL}/run-task`, payload, { headers });

  // Check response
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response has taskId': (r) => JSON.parse(r.body).taskId !== undefined,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // Random sleep between requests
  sleep(Math.random() * 2 + 0.5);
}

// Setup function
export function setup() {
  console.log('Starting load test...');
  console.log('Target: ' + BASE_URL);
  
  // Check if agent is healthy
  const response = http.get(`${BASE_URL}/health`);
  check(response, {
    'agent is healthy': (r) => r.status === 200,
  });
  
  return { startTime: Date.now() };
}

// Teardown function
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration}s`);
}
