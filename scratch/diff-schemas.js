const fs = require('fs');
const actual = JSON.parse(fs.readFileSync('schema_drift_actual.json', 'utf8'));
const expected = JSON.parse(fs.readFileSync('schema_drift_expected.json', 'utf8'));

function diff(obj1, obj2, path = '') {
  if (typeof obj1 !== typeof obj2) {
    console.log(`Type mismatch at ${path}: ${typeof obj1} vs ${typeof obj2}`);
    return;
  }
  if (Array.isArray(obj1)) {
    if (obj1.length !== obj2.length) {
      console.log(`Array length mismatch at ${path}: ${obj1.length} vs ${obj2.length}`);
    }
    for (let i = 0; i < Math.min(obj1.length, obj2.length); i++) {
      diff(obj1[i], obj2[i], `${path}[${i}]`);
    }
    return;
  }
  if (obj1 !== null && typeof obj1 === 'object') {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    const allKeys = new Set([...keys1, ...keys2]);
    for (const key of allKeys) {
      if (!(key in obj1)) {
        console.log(`Missing key in actual at ${path}.${key}`);
      } else if (!(key in obj2)) {
        console.log(`Missing key in expected at ${path}.${key}`);
      } else {
        diff(obj1[key], obj2[key], `${path}.${key}`);
      }
    }
    return;
  }
  if (obj1 !== obj2) {
    console.log(`Value mismatch at ${path}: ${obj1} vs ${obj2}`);
  }
}

diff(actual, expected);
