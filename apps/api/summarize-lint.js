import fs from 'fs';

const results = JSON.parse(fs.readFileSync('lint-results.json', 'utf8'));

const summary = results.map(file => ({
  filePath: file.filePath,
  errorCount: file.errorCount,
  warningCount: file.warningCount,
})).sort((a, b) => b.errorCount - a.errorCount);

console.log(JSON.stringify(summary.slice(0, 20), null, 2));
