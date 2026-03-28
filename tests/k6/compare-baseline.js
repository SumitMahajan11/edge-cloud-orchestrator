#!/usr/bin/env node

/**
 * Baseline Comparison Script
 * 
 * Compares current test results against stored baseline to detect regressions.
 * 
 * Usage:
 *   node compare-baseline.js results.json
 *   node compare-baseline.js results.json --update  # Update baseline
 */

const fs = require('fs');
const path = require('path');

// Configuration
const BASELINE_FILE = path.join(__dirname, 'baseline.json');
const REGRESSION_THRESHOLDS = {
  p95_latency_increase_percent: 20,    // Alert if p95 increases > 20%
  p99_latency_increase_percent: 25,    // Alert if p99 increases > 25%
  error_rate_increase_percent: 50,     // Alert if error rate increases > 50%
  throughput_decrease_percent: 15,     // Alert if throughput decreases > 15%
  min_requests_for_significance: 100,  // Minimum requests for valid comparison
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function loadResults(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    log(`Error loading results from ${filePath}: ${error.message}`, 'red');
    process.exit(1);
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    log('No baseline found. Creating initial baseline from current results.', 'yellow');
    return null;
  }
  return loadResults(BASELINE_FILE);
}

function saveBaseline(results) {
  const baseline = {
    created: new Date().toISOString(),
    metrics: {
      http_reqs: results.metrics.http_reqs?.values,
      http_req_duration: results.metrics.http_req_duration?.values,
      http_req_failed: results.metrics.http_req_failed?.values,
      iterations: results.metrics.iterations?.values,
    },
    custom_metrics: extractCustomMetrics(results),
  };
  
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  log(`Baseline saved to ${BASELINE_FILE}`, 'green');
}

function extractCustomMetrics(results) {
  const custom = {};
  const metricNames = [
    'task_submit_success',
    'task_submit_duration',
    'node_list_success',
    'node_get_success',
    'ws_message_latency',
  ];
  
  for (const name of metricNames) {
    if (results.metrics[name]?.values) {
      custom[name] = results.metrics[name].values;
    }
  }
  
  return custom;
}

function calculateChange(current, baseline, key) {
  if (!baseline || baseline[key] === undefined || current[key] === undefined) {
    return null;
  }
  
  const currentVal = current[key];
  const baselineVal = baseline[key];
  
  if (baselineVal === 0) return null;
  
  return {
    current: currentVal,
    baseline: baselineVal,
    change: currentVal - baselineVal,
    changePercent: ((currentVal - baselineVal) / baselineVal) * 100,
  };
}

function compareResults(current, baseline) {
  if (!baseline) {
    return { status: 'no_baseline', regressions: [], improvements: [] };
  }
  
  const regressions = [];
  const improvements = [];
  const currentMetrics = current.metrics;
  const baselineMetrics = baseline.metrics;
  
  // Compare HTTP request duration
  const durationComparison = {
    p50: calculateChange(
      currentMetrics.http_req_duration?.values || {},
      baselineMetrics.http_req_duration?.values || {},
      'p(50)'
    ),
    p95: calculateChange(
      currentMetrics.http_req_duration?.values || {},
      baselineMetrics.http_req_duration?.values || {},
      'p(95)'
    ),
    p99: calculateChange(
      currentMetrics.http_req_duration?.values || {},
      baselineMetrics.http_req_duration?.values || {},
      'p(99)'
    ),
    avg: calculateChange(
      currentMetrics.http_req_duration?.values || {},
      baselineMetrics.http_req_duration?.values || {},
      'avg'
    ),
  };
  
  // Check p95 regression
  if (durationComparison.p95?.changePercent > REGRESSION_THRESHOLDS.p95_latency_increase_percent) {
    regressions.push({
      metric: 'p95 Latency',
      baseline: durationComparison.p95.baseline.toFixed(2) + 'ms',
      current: durationComparison.p95.current.toFixed(2) + 'ms',
      change: '+' + durationComparison.p95.changePercent.toFixed(1) + '%',
      threshold: REGRESSION_THRESHOLDS.p95_latency_increase_percent + '%',
    });
  } else if (durationComparison.p95?.changePercent < -10) {
    improvements.push({
      metric: 'p95 Latency',
      improvement: Math.abs(durationComparison.p95.changePercent).toFixed(1) + '% faster',
    });
  }
  
  // Check p99 regression
  if (durationComparison.p99?.changePercent > REGRESSION_THRESHOLDS.p99_latency_increase_percent) {
    regressions.push({
      metric: 'p99 Latency',
      baseline: durationComparison.p99.baseline.toFixed(2) + 'ms',
      current: durationComparison.p99.current.toFixed(2) + 'ms',
      change: '+' + durationComparison.p99.changePercent.toFixed(1) + '%',
      threshold: REGRESSION_THRESHOLDS.p99_latency_increase_percent + '%',
    });
  }
  
  // Compare error rate
  const errorRateComparison = calculateChange(
    currentMetrics.http_req_failed?.values || {},
    baselineMetrics.http_req_failed?.values || {},
    'rate'
  );
  
  if (errorRateComparison?.changePercent > REGRESSION_THRESHOLDS.error_rate_increase_percent) {
    regressions.push({
      metric: 'Error Rate',
      baseline: (errorRateComparison.baseline * 100).toFixed(3) + '%',
      current: (errorRateComparison.current * 100).toFixed(3) + '%',
      change: '+' + errorRateComparison.changePercent.toFixed(1) + '%',
      threshold: REGRESSION_THRESHOLDS.error_rate_increase_percent + '%',
    });
  }
  
  // Compare throughput
  const currentRps = currentMetrics.http_reqs?.values?.rate || 0;
  const baselineRps = baselineMetrics.http_reqs?.values?.rate || 0;
  
  if (baselineRps > 0) {
    const throughputChange = ((currentRps - baselineRps) / baselineRps) * 100;
    
    if (throughputChange < -REGRESSION_THRESHOLDS.throughput_decrease_percent) {
      regressions.push({
        metric: 'Throughput',
        baseline: baselineRps.toFixed(2) + ' req/s',
        current: currentRps.toFixed(2) + ' req/s',
        change: throughputChange.toFixed(1) + '%',
        threshold: '-' + REGRESSION_THRESHOLDS.throughput_decrease_percent + '%',
      });
    } else if (throughputChange > 10) {
      improvements.push({
        metric: 'Throughput',
        improvement: '+' + throughputChange.toFixed(1) + '%',
      });
    }
  }
  
  return {
    status: regressions.length > 0 ? 'regression' : 'passed',
    regressions,
    improvements,
    details: {
      duration: durationComparison,
      errorRate: errorRateComparison,
      throughput: { current: currentRps, baseline: baselineRps },
    },
  };
}

function printReport(comparison) {
  console.log('\n' + '='.repeat(70));
  log('                    PERFORMANCE COMPARISON REPORT', 'bold');
  console.log('='.repeat(70));
  
  if (comparison.status === 'no_baseline') {
    log('\n  No baseline found. Current results will be saved as baseline.', 'yellow');
    console.log('='.repeat(70) + '\n');
    return;
  }
  
  // Print summary
  console.log('\n  SUMMARY');
  console.log('  -------');
  
  if (comparison.status === 'passed') {
    log('  Status: PASSED ✓', 'green');
    log('  No performance regressions detected.', 'green');
  } else {
    log('  Status: REGRESSION DETECTED ✗', 'red');
    log(`  Found ${comparison.regressions.length} regression(s).`, 'red');
  }
  
  // Print regressions
  if (comparison.regressions.length > 0) {
    console.log('\n  REGRESSIONS');
    console.log('  -----------');
    
    for (const reg of comparison.regressions) {
      log(`\n  ${reg.metric}:`, 'yellow');
      console.log(`    Baseline:  ${reg.baseline}`);
      console.log(`    Current:   ${reg.current}`);
      log(`    Change:    ${reg.change}`, 'red');
      console.log(`    Threshold: ${reg.threshold}`);
    }
  }
  
  // Print improvements
  if (comparison.improvements.length > 0) {
    console.log('\n  IMPROVEMENTS');
    console.log('  ------------');
    
    for (const imp of comparison.improvements) {
      log(`  ${imp.metric}: ${imp.improvement}`, 'green');
    }
  }
  
  // Print detailed metrics
  const d = comparison.details;
  if (d) {
    console.log('\n  DETAILED METRICS');
    console.log('  ----------------');
    console.log('  Latency:');
    console.log(`    p50: ${d.duration.p50?.current?.toFixed(2) || 'N/A'}ms (baseline: ${d.duration.p50?.baseline?.toFixed(2) || 'N/A'}ms)`);
    console.log(`    p95: ${d.duration.p95?.current?.toFixed(2) || 'N/A'}ms (baseline: ${d.duration.p95?.baseline?.toFixed(2) || 'N/A'}ms)`);
    console.log(`    p99: ${d.duration.p99?.current?.toFixed(2) || 'N/A'}ms (baseline: ${d.duration.p99?.baseline?.toFixed(2) || 'N/A'}ms)`);
    console.log(`  Error Rate: ${((d.errorRate?.current || 0) * 100).toFixed(3)}%`);
    console.log(`  Throughput: ${d.throughput.current?.toFixed(2)} req/s`);
  }
  
  console.log('\n' + '='.repeat(70) + '\n');
}

// Main
function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update');
  const resultsFile = args.find(a => !a.startsWith('--'));
  
  if (!resultsFile) {
    log('Usage: node compare-baseline.js <results.json> [--update]', 'red');
    process.exit(1);
  }
  
  const current = loadResults(resultsFile);
  const baseline = loadBaseline();
  
  const comparison = compareResults(current, baseline);
  printReport(comparison);
  
  if (updateBaseline || comparison.status === 'no_baseline') {
    saveBaseline(current);
  }
  
  // Exit with error code if regressions found
  if (comparison.status === 'regression') {
    process.exit(1);
  }
}

main();
