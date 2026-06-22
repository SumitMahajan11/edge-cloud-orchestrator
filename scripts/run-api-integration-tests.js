const { spawn, spawnSync } = require('child_process');
const http = require('http');

function checkServerReady() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3090/health', (res) => {
      // Any response (even if status code is not 200, e.g. 503 or 401) means the port is listening.
      // But /health should return 200.
      resolve(res.statusCode === 200);
    });
    req.on('error', () => {
      resolve(false);
    });
    // Set a short timeout for the connection attempt
    req.setTimeout(500);
    req.end();
  });
}

async function main() {
  console.log('=========================================');
  console.log('Starting API Gateway in Mock Mode...');
  console.log('=========================================');

  // Start the server using tsx directly to avoid watch restarts
  const server = spawn('pnpm', ['--filter', '@edgecloud/api', 'exec', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: '3090',
      FORCE_MOCK_DB: 'true',
      FORCE_MOCK_REDIS: 'true',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      RATE_LIMIT_TEST_MODE: 'true',
      ALLOW_PRIVATE_IPS: 'true',
    },
    shell: true,
  });

  // Log server output to stderr/stdout to help debug if needed
  server.stdout.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  server.stderr.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  let serverStarted = false;

  // Poll /health endpoint (up to 45 seconds)
  console.log('Polling http://localhost:3090/health for readiness...');
  for (let i = 0; i < 45; i++) {
    const ready = await checkServerReady();
    if (ready) {
      serverStarted = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!serverStarted) {
    console.error('Failed to detect server readiness on http://localhost:3090/health within 45 seconds.');
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', server.pid]);
    } else {
      server.kill();
    }
    process.exit(1);
  }

  console.log('=========================================');
  console.log('API Gateway is active! Running tests...');
  console.log('=========================================');

  // Run the test suite asynchronously to avoid blocking the event loop
  // and causing stdout pipe deadlocks with the API server.
  const testPromise = new Promise((resolve) => {
    const testProcess = spawn('pnpm', ['test', 'apps/api/tests/integration.test.ts', 'apps/api/tests/versioning.test.ts'], {
      env: {
        ...process.env,
        RUN_INTEGRATION_TESTS: 'true',
        API_URL: 'http://localhost:3090',
        ALLOW_PRIVATE_IPS: 'true',
      },
      shell: true,
      stdio: 'inherit',
    });

    testProcess.on('close', (code) => {
      resolve(code);
    });
  });

  const exitCode = await testPromise;

  console.log('=========================================');
  console.log('Stopping API Gateway server...');
  console.log('=========================================');

  // Terminate the server process tree
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', server.pid]);
  } else {
    server.kill();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
