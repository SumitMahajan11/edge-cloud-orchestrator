const fs = require('fs');
const path = require('path');

const targetDirs = [
  path.join(__dirname, '..', 'apps', 'api', 'src'),
  path.join(__dirname, '..', 'apps', 'agent', 'src'),
  path.join(__dirname, '..', 'packages')
];

const results = [];

function analyzeFile(filePath) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  if (relativePath.includes('node_modules') || 
      relativePath.includes('dist') || 
      relativePath.includes('target') || 
      relativePath.includes('__tests__') || 
      relativePath.includes('tests') || 
      relativePath.endsWith('.gen.ts') || 
      relativePath.includes('.next') ||
      relativePath.endsWith('.test.ts') ||
      relativePath.endsWith('.spec.ts')) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let commentLines = 0;
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      commentLines++;
    }
  }

  const ratio = lines.length > 0 ? Math.round((commentLines / lines.length) * 1000) / 1000 : 0;
  
  results.push({
    file: relativePath,
    lines: lines.length,
    comments: commentLines,
    ratio
  });
}

function traverse(dir) {
  if (!fs.existsSync(dir)) return;
  const stats = fs.statSync(dir);
  if (stats.isDirectory()) {
    const list = fs.readdirSync(dir);
    for (let item of list) {
      traverse(path.join(dir, item));
    }
  } else if (stats.isFile()) {
    const ext = path.extname(dir);
    if (ext === '.ts' || ext === '.rs') {
      analyzeFile(dir);
    }
  }
}

for (let dir of targetDirs) {
  traverse(dir);
}

results.sort((a, b) => a.ratio - b.ratio);

console.log('Top 25 files with size > 150 lines and lowest comment density:');
console.log('-------------------------------------------------------------');
const filtered = results.filter(r => r.lines > 150).slice(0, 25);
for (let r of filtered) {
  console.log(`${r.file.padEnd(50)} | Lines: ${String(r.lines).padStart(5)} | Comments: ${String(r.comments).padStart(4)} | Ratio: ${r.ratio.toFixed(3)}`);
}
