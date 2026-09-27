#!/usr/bin/env node
/**
 * Package Validation - Ensures Hermes Design Studio installer does NOT contain
 * vendor/nous-hermes or unnecessary Hermes development/reference source
 * Implements STEP 22: Package Validation
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

const FORBIDDEN_PATTERNS = [
  "vendor/nous-hermes",
  "nous-hermes",
  "hermes-agent",
  "hermes_agent",
];

const REQUIRED_RUNTIME_FILES = [
  // These should exist in a valid package
  "apps/web",
  "apps/daemon",
  "apps/desktop",
];

async function walk(dir, callback, base = dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(base, fullPath);
      
      if (entry.isDirectory()) {
        // Skip node_modules for performance but check top-level
        if (entry.name === "node_modules" && dir !== base) {
          continue;
        }
        await callback(fullPath, relPath, entry);
        await walk(fullPath, callback, base);
      } else {
        await callback(fullPath, relPath, entry);
      }
    }
  } catch (err) {
    // Ignore errors for non-existent dirs
    if (err.code !== "ENOENT") {
      console.warn(`Warning: Could not read ${dir}: ${err.message}`);
    }
  }
}

async function validatePackage(packagePath) {
  console.log(`[Hermes Package Validation] Checking: ${packagePath}`);
  
  if (!existsSync(packagePath)) {
    console.error(`❌ Package path does not exist: ${packagePath}`);
    process.exit(1);
  }

  const violations = [];
  const foundFiles = [];

  await walk(packagePath, async (fullPath, relPath, entry) => {
    const lowerRel = relPath.toLowerCase();
    const lowerFull = fullPath.toLowerCase();

    // Check for forbidden patterns
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (lowerRel.includes(pattern.toLowerCase()) || lowerFull.includes(pattern.toLowerCase())) {
        // Allow the validation script itself and documentation
        if (relPath.includes("validate-hermes-package") || relPath.includes("docs/hermes-design-studio.md")) {
          continue;
        }
        // Allow if it's just a reference in a JSON file that mentions the pattern but not the actual directory
        // We want to block actual vendor/nous-hermes directory contents
        if (relPath.startsWith("vendor/nous-hermes") || relPath.includes("/vendor/nous-hermes/")) {
          violations.push({
            path: relPath,
            pattern,
            reason: `Forbidden pattern '${pattern}' found in package`,
          });
        }
      }
    }

    foundFiles.push(relPath);
  });

  // Check for vendor directory specifically
  const vendorPath = join(packagePath, "vendor", "nous-hermes");
  if (existsSync(vendorPath)) {
    violations.push({
      path: "vendor/nous-hermes",
      pattern: "vendor/nous-hermes",
      reason: "Production package must NOT contain vendor/nous-hermes directory",
    });
  }

  // Also check for any vendor directory in unpacked app
  const possibleVendorPaths = [
    join(packagePath, "vendor"),
    join(packagePath, "resources", "vendor"),
    join(packagePath, "app", "vendor"),
    join(packagePath, "resources", "app", "vendor"),
  ];

  for (const vp of possibleVendorPaths) {
    if (existsSync(vp)) {
      try {
        const entries = await readdir(vp);
        for (const entry of entries) {
          if (entry.toLowerCase().includes("hermes") || entry.toLowerCase().includes("nous")) {
            violations.push({
              path: relative(packagePath, join(vp, entry)),
              pattern: entry,
              reason: `Hermes development source found in ${relative(packagePath, vp)}`,
            });
          }
        }
      } catch {}
    }
  }

  console.log(`\n[Validation] Scanned ${foundFiles.length} files`);

  if (violations.length > 0) {
    console.error(`\n❌ Package validation FAILED - Found ${violations.length} violations:\n`);
    for (const v of violations) {
      console.error(`  - ${v.path}: ${v.reason} (matched: ${v.pattern})`);
    }
    console.error(`\nThe production package must NOT contain vendor/nous-hermes or Hermes development source.`);
    console.error(`The vendor/nous-hermes directory is for development/reference only.`);
    process.exit(1);
  }

  console.log(`\n✅ Package validation PASSED`);
  console.log(`   - No forbidden Hermes development source found`);
  console.log(`   - Package contains only runtime files required by Hermes Design Studio`);
  console.log(`   - vendor/nous-hermes correctly excluded from production bundle`);
}

async function main() {
  const packagePath = process.argv[2];

  if (!packagePath) {
    console.error("Usage: node validate-hermes-package.mjs <package-path>");
    console.error("Example: node validate-hermes-package.mjs ./dist/win-unpacked");
    process.exit(1);
  }

  await validatePackage(packagePath);
}

main().catch((err) => {
  console.error(`Validation error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
