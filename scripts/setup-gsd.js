#!/usr/bin/env node

/**
 * GSD Setup Script
 * Initializes GitHub Standard Development workflow
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🚀 Setting up GSD (GitHub Standard Development)...");

try {
  // Check if we're in a git repository
  execSync("git rev-parse --git-dir", { stdio: "pipe" });
  console.log("✅ Git repository detected");
} catch (error) {
  console.log("❌ Not in a git repository. Please initialize git first.");
  process.exit(1);
}

try {
  // Install husky for git hooks
  console.log("📦 Installing husky for git hooks...");
  execSync("pnpm add -D husky lint-staged", { stdio: "inherit" });

  // Set up git hooks path
  console.log("🔗 Configuring git hooks...");
  execSync("git config core.hooksPath .githooks", { stdio: "inherit" });

  // Make hooks executable
  const hooksDir = path.join(__dirname, "..", ".githooks");
  const hooks = fs.readdirSync(hooksDir);

  hooks.forEach((hook) => {
    const hookPath = path.join(hooksDir, hook);
    if (fs.statSync(hookPath).isFile()) {
      fs.chmodSync(hookPath, "755");
      console.log(`✅ Made ${hook} executable`);
    }
  });

  // Create .lintstagedrc.json
  const lintstagedrc = {
    "*.{ts,js}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"],
  };

  fs.writeFileSync(
    path.join(__dirname, "..", ".lintstagedrc.json"),
    JSON.stringify(lintstagedrc, null, 2),
  );
  console.log("✅ Created .lintstagedrc.json");

  // Update package.json with lint-staged config
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  packageJson["lint-staged"] = {
    "*.{ts,js}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"],
  };

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log("✅ Updated package.json with lint-staged config");

  console.log("🎉 GSD setup complete!");
  console.log("");
  console.log("Next steps:");
  console.log("1. Run: pnpm gsd:check");
  console.log("2. Run: pnpm gsd:fix");
  console.log("3. Make your first commit to test the hooks");
} catch (error) {
  console.error("❌ GSD setup failed:", error.message);
  process.exit(1);
}
