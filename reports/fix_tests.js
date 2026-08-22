const fs = require('fs');

function fixAuditSpec() {
  const file = 'apps/api/src/services/__tests__/task-scheduler.audit.spec.ts';
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(
    /update: vi\.fn\(\),/g,
    'update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, attemptNumber: args.data.attemptNumber || 1 })),'
  );
  fs.writeFileSync(file, content);
}

function fixZombieTest() {
  const file = 'apps/api/tests/integration/zombie-task-recovery.test.ts';
  let content = fs.readFileSync(file, 'utf8');
  
  // Mock edgeNode.findUnique
  content = content.replace(
    'findUnique: vi.fn(),',
    "findUnique: vi.fn().mockResolvedValue({ id: 'node-1', status: 'ONLINE', tasksRunning: 0, maxTasks: 10 }),"
  );
  
  // Mock taskExecution.update to return attemptNumber
  content = content.replace(
    'update: vi.fn(),',
    'update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, attemptNumber: 1 })),'
  );
  
  fs.writeFileSync(file, content);
}

fixAuditSpec();
fixZombieTest();
