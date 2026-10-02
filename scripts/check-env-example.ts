#!/usr/bin/env node
/**
 * scripts/check-env-example.ts
 *
 * Verifies that all environment variables accessed in application source code,
 * schemas, Dockerfiles, and startup scripts are documented in the respective
 * app's .env.example file.
 *
 * Exits with status code 1 if any app reads an env variable missing from its .env.example.
 */

import * as fs from 'fs';
import * as path from 'path';

// Standard system/runtime variables that are not application configuration
const SYSTEM_IGNORED_VARS = new Set([
  'PATH',
  'NODE_PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'PWD',
  'OLDPWD',
  '_',
  'npm_package_version',
  'npm_package_name',
  'npm_lifecycle_event',
  'npm_config_user_agent',
  'CI',
  'TZ',
]);

interface AppCheckResult {
  appName: string;
  appDir: string;
  envExamplePath: string;
  declaredVars: Set<string>;
  foundVars: Map<string, string[]>; // varName -> file locations
  missingVars: string[];
}

/**
 * Parses all environment variable names defined in a .env.example file.
 */
function parseEnvExample(filePath: string): Set<string> {
  const vars = new Set<string>();
  if (!fs.existsSync(filePath)) {
    return vars;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Matches `KEY=value`, `# KEY=value`, `# [REQUIRED] KEY=value`, `# KEY=`, etc.
    const match = trimmed.match(/^(?:#\s*(?:\[[^\]]+\]\s*)?)?([A-Z0-9_]{2,})\s*=/);
    if (match && match[1]) {
      vars.add(match[1]);
    }
  }

  return vars;
}

/**
 * Recursively find all files in a directory excluding ignored directories.
 */
function getFilesRecursive(dir: string, ignoreDirs: Set<string> = new Set(['node_modules', 'dist', 'target', '.next', 'coverage', '.git', 'benches', '__tests__'])): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        results = results.concat(getFilesRecursive(fullPath, ignoreDirs));
      }
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts environment variables accessed in a file.
 */
function extractEnvVarsFromFile(filePath: string): string[] {
  const vars: string[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // 1. process.env.VAR_NAME or process.env['VAR_NAME'] or process.env["VAR_NAME"]
  const processEnvRegex = /process\.env(?:\.([A-Z0-9_]{2,})|\[['"]([A-Z0-9_]{2,})['"]\])/g;
  let match: RegExpExecArray | null;
  while ((match = processEnvRegex.exec(content)) !== null) {
    const v = match[1] || match[2];
    if (v && !SYSTEM_IGNORED_VARS.has(v)) {
      vars.push(v);
    }
  }

  // 2. Rust: env::var("VAR_NAME") or env::var_os("VAR_NAME")
  if (ext === '.rs') {
    const rustEnvRegex = /env::(?:var|var_os)\s*\(\s*"([A-Z0-9_]{2,})"\s*\)/g;
    while ((match = rustEnvRegex.exec(content)) !== null) {
      if (match[1] && !SYSTEM_IGNORED_VARS.has(match[1])) {
        vars.push(match[1]);
      }
    }
  }

  // 3. Zod schema definitions in env.ts / config files: `KEY: z.` or `KEY:`
  if (basename.includes('env') && (ext === '.ts' || ext === '.js')) {
    const zodFieldRegex = /^\s*([A-Z0-9_]{2,})\s*:\s*z\./gm;
    while ((match = zodFieldRegex.exec(content)) !== null) {
      if (match[1] && !SYSTEM_IGNORED_VARS.has(match[1])) {
        vars.push(match[1]);
      }
    }
  }

  // 4. Shell / entrypoint scripts: ${VAR_NAME:-default} or $VAR_NAME reads
  if (ext === '.sh' || basename.endsWith('.sh') || basename === 'entrypoint.sh') {
    // Find local assignments so we don't treat local variables as env vars
    const localAssigned = new Set<string>();
    const assignLines = content.split('\n');
    for (const line of assignLines) {
      const assignMatch = line.trim().match(/^(?:local\s+)?([A-Z0-9_]{2,})=/);
      if (assignMatch && assignMatch[1]) {
        localAssigned.add(assignMatch[1]);
      }
    }

    // Capture environment expansion like ${VAR:-default} or ${VAR:=default}
    const envExpansionRegex = /\$\{([A-Z0-9_]{2,})(?::-|:=|:|\})/g;
    while ((match = envExpansionRegex.exec(content)) !== null) {
      const v = match[1];
      if (v && !SYSTEM_IGNORED_VARS.has(v)) {
        vars.push(v);
      }
    }

    // Capture condition checks like [ -n "$VAR" ] or [ -z "$VAR" ]
    const condCheckRegex = /\[\s*-[nz]\s*["']?\$([A-Z0-9_]{2,})["']?\s*\]/g;
    while ((match = condCheckRegex.exec(content)) !== null) {
      const v = match[1];
      if (v && !SYSTEM_IGNORED_VARS.has(v) && !localAssigned.has(v)) {
        vars.push(v);
      }
    }
  }

  // 5. Dockerfile: ENV VAR_NAME=... or ARG VAR_NAME=...
  if (basename.startsWith('dockerfile')) {
    const dockerEnvRegex = /^\s*(?:ENV|ARG)\s+([A-Z0-9_]{2,})/gm;
    while ((match = dockerEnvRegex.exec(content)) !== null) {
      if (match[1] && !SYSTEM_IGNORED_VARS.has(match[1]) && !match[1].startsWith('PNPM_')) {
        vars.push(match[1]);
      }
    }
  }

  return vars;
}

/**
 * Main verification routine.
 */
function main() {
  console.log('🔍 Running environment variables validation across all apps...\n');

  // Find apps directory
  let rootDir = process.cwd();
  let appsDir = path.join(rootDir, 'apps');
  if (!fs.existsSync(appsDir)) {
    appsDir = path.join(rootDir, 'edge-cloud-orchestrator', 'apps');
    rootDir = path.join(rootDir, 'edge-cloud-orchestrator');
  }

  if (!fs.existsSync(appsDir)) {
    console.error(`❌ Could not locate apps directory at ${appsDir}`);
    process.exit(1);
  }

  const appEntries = fs.readdirSync(appsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const results: AppCheckResult[] = [];
  let totalMissing = 0;

  for (const appName of appEntries) {
    const appDir = path.join(appsDir, appName);
    const envExamplePath = path.join(appDir, '.env.example');

    const declaredVars = parseEnvExample(envExamplePath);
    const foundVars = new Map<string, string[]>();

    const files = getFilesRecursive(appDir);
    for (const file of files) {
      const relPath = path.relative(appDir, file);
      // Skip test files, mock databases, and log files
      if (
        relPath.includes('__tests__') ||
        relPath.includes('.test.') ||
        relPath.includes('.spec.') ||
        relPath.endsWith('.log') ||
        relPath.endsWith('.json') ||
        relPath.includes('mock-') ||
        relPath.includes('scratch-') ||
        relPath.includes('.example')
      ) {
        continue;
      }

      const extracted = extractEnvVarsFromFile(file);
      for (const v of extracted) {
        const locations = foundVars.get(v) || [];
        locations.push(relPath);
        foundVars.set(v, locations);
      }
    }

    // Determine missing vars
    const missingVars: string[] = [];
    for (const varName of foundVars.keys()) {
      if (!declaredVars.has(varName)) {
        missingVars.push(varName);
      }
    }

    missingVars.sort();
    totalMissing += missingVars.length;

    results.push({
      appName,
      appDir,
      envExamplePath,
      declaredVars,
      foundVars,
      missingVars,
    });
  }

  // Print results
  console.log('=' .repeat(78));
  console.log(' APPLICATION .env.example AUDIT REPORT');
  console.log('='.repeat(78));

  for (const res of results) {
    const hasExample = fs.existsSync(res.envExamplePath);
    const statusIcon = !hasExample ? '❌' : res.missingVars.length === 0 ? '✅' : '❌';

    console.log(`\n${statusIcon} App: apps/${res.appName}`);
    console.log(`   .env.example: ${hasExample ? 'Found (' + res.declaredVars.size + ' variables)' : 'MISSING'}`);
    console.log(`   Code References: ${res.foundVars.size} unique env vars scanned`);

    if (res.missingVars.length > 0) {
      console.log(`   ⚠️  Missing from .env.example (${res.missingVars.length}):`);
      for (const missing of res.missingVars) {
        const locs = (res.foundVars.get(missing) || []).slice(0, 3).join(', ');
        console.log(`      - ${missing} (used in: ${locs})`);
      }
    } else {
      console.log('   All referenced environment variables are documented.');
    }
  }

  console.log('\n' + '='.repeat(78));
  if (totalMissing > 0) {
    console.error(`\n❌ Validation FAILED: Found ${totalMissing} environment variable(s) missing from .env.example files.\n`);
    process.exit(1);
  } else {
    console.log(`\n✅ Validation PASSED: All ${results.length} apps have comprehensive, verified .env.example files.\n`);
    process.exit(0);
  }
}

main();
