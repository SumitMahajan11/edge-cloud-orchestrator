const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\SUMIT\\.gemini\\antigravity\\brain';
const dirs = fs.readdirSync(brainDir);

dirs.forEach(dir => {
  const logFile = path.join(brainDir, dir, '.system_generated', 'logs', 'overview.txt');
  if (fs.existsSync(logFile)) {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('FINAL-AUDIT') && !line.includes('search_log.js')) {
        console.log(`Conv ${dir} | Line ${index + 1}: length=${line.length}, preview=${line.substring(0, 150)}`);
      }
    });
  }
});
