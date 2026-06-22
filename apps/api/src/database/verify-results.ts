import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const taskId = 'e2e-proof-task-100';

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      executions: true,
      logs: true,
    },
  });

  if (!task) {
    console.error(`Task ${taskId} not found!`);
    process.exit(1);
  }

  console.log('--- TASK STATUS ---');
  console.log(`Task ID: ${task.id}`);
  console.log(`Status: ${task.status}`);
  console.log(`Updated At: ${(task as any).updatedAt}`);

  console.log('\n--- EXECUTIONS ---');
  if (task.executions.length === 0) {
    console.log('No execution records found.');
  } else {
    for (const exec of task.executions) {
      console.log(`Execution ID: ${exec.id}`);
      console.log(`Status: ${exec.status}`);
      console.log(`Exit Code: ${exec.exitCode}`);
      const outputObj = exec.output as any;
      console.log(`Stdout:\n${outputObj?.stdout || '(empty)'}`);
      console.log(`Stderr:\n${outputObj?.stderr || '(empty)'}`);
      console.log(`Error Message: ${exec.error || '(none)'}`);
      console.log('------------------');
    }
  }

  console.log('\n--- LOGS ---');
  if (task.logs.length === 0) {
    console.log('No logs found.');
  } else {
    for (const log of task.logs) {
      console.log(`[${log.timestamp.toISOString()}] [${log.level}] ${log.message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Failed to query results:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
