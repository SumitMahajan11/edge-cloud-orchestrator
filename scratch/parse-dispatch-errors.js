const fs = require('fs');
const readline = require('readline');

async function parseErrors() {
  const fileStream = fs.createReadStream('tests/load/results/api-run.log');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Searching for Dispatch failed errors with context...');
  let linesToPrint = 0;
  let matches = 0;
  for await (const line of rl) {
    const cleanLine = line.replace(/\u001b\[\d+m/g, '');
    if (cleanLine.includes('Dispatch failed, reverting to PENDING')) {
      linesToPrint = 15;
      matches++;
      console.log('--- MATCH ' + matches + ' ---');
    }
    if (linesToPrint > 0) {
      console.log(cleanLine);
      linesToPrint--;
      if (linesToPrint === 0 && matches >= 5) {
        break;
      }
    }
  }
}

parseErrors().catch(console.error);
