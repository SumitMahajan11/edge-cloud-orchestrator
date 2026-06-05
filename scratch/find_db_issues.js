const fs = require("fs");

const targets = [
  { file: "apps/api/src/routes/admin.ts", lines: [60, 93] },
  { file: "apps/api/src/routes/api-keys.ts", lines: [20] },
  { file: "apps/api/src/routes/cost.ts", lines: [90] },
  { file: "apps/api/src/routes/federated-learning.ts", lines: [20] },
  { file: "apps/api/src/routes/logs.ts", lines: [31] },
  { file: "apps/api/src/routes/nodes.ts", lines: [504, 698] },
  { file: "apps/api/src/routes/scheduler.ts", lines: [52] },
  { file: "apps/api/src/routes/tasks.ts", lines: [512] },
  { file: "apps/api/src/routes/webhooks.ts", lines: [27, 200] },
  { file: "apps/api/src/routes/workflows.ts", lines: [24] },
];

targets.forEach((t) => {
  const content = fs.readFileSync(t.file, "utf8").split("\n");
  t.lines.forEach((l) => {
    console.log(`\n=== ${t.file} Line ${l} ===`);
    // print 15 lines before and 5 lines after the return
    const start = Math.max(0, l - 15);
    const end = Math.min(content.length, l + 5);
    console.log(content.slice(start, end).join("\n"));
  });
});
