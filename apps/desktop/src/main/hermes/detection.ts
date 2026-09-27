/**
 * Hermes Detection - Automatic discovery of Hermes installation
 * Implements real automatic Hermes discovery per STEP 3
 */

import { existsSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HermesDetectionResult, HermesConnectionState } from "./types.js";
import { HERMES_CONNECTION_STATES } from "./types.js";

const execFileAsync = promisify(execFile);

const HERMES_ENDPOINTS = [
  "http://127.0.0.1:18789", // Default Hermes desktop endpoint
  "http://127.0.0.1:18790",
  "http://127.0.0.1:3456",
  "http://localhost:18789",
];

const HERMES_CONFIG_FILES = ["config.yaml", "config.json"];

export interface HermesDetectionOptions {
  hermesHome?: string;
  checkEndpoints?: boolean;
  timeoutMs?: number;
}

/**
 * Resolve Hermes home directory using real Hermes architecture
 * Supports HERMES_HOME env var, Windows locations, and default ~/.hermes
 */
export function resolveHermesHome(): string | null {
  // 1. Check HERMES_HOME env var (documented in hermes_constants.py)
  const envHome = process.env.HERMES_HOME || process.env.HERMES_HOME_DIR;
  if (envHome && envHome.trim()) {
    return resolve(envHome.trim());
  }

  // 2. Check platform-specific defaults
  const home = homedir();
  const isWindows = platform() === "win32";

  if (isWindows) {
    // Windows installation locations
    const candidates = [
      process.env.APPDATA ? join(process.env.APPDATA, "hermes") : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "hermes") : null,
      join(home, ".hermes"),
      join(home, "AppData", "Roaming", "hermes"),
      join(home, "AppData", "Local", "hermes"),
      "C:\\Program Files\\Hermes",
      "C:\\Program Files (x86)\\Hermes",
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    // Default to ~/.hermes even if not exists (for NOT_INSTALLED detection)
    return join(home, ".hermes");
  } else {
    // Unix: ~/.hermes
    return join(home, ".hermes");
  }
}

/**
 * Check if Hermes executable is available on PATH
 */
export async function findHermesExecutable(): Promise<string | null> {
  const isWindows = platform() === "win32";
  const executableNames = isWindows ? ["hermes.exe", "hermes.cmd", "hermes"] : ["hermes"];

  // Try which/where command
  try {
    const cmd = isWindows ? "where" : "which";
    for (const name of executableNames) {
      try {
        const { stdout } = await execFileAsync(cmd, [name], { timeout: 3000 });
        const found = stdout.split("\n")[0]?.trim();
        if (found && existsSync(found)) {
          return found;
        }
      } catch {
        // Continue to next
      }
    }
  } catch {
    // Fall through
  }

  // Check common installation paths
  const home = homedir();
  const commonPaths = isWindows
    ? [
        join(home, ".local", "bin", "hermes.exe"),
        join(home, "AppData", "Local", "Programs", "hermes", "hermes.exe"),
        "C:\\Program Files\\Hermes\\hermes.exe",
        join(process.env.LOCALAPPDATA || "", "Programs", "hermes", "hermes.exe"),
      ]
    : [
        join(home, ".local", "bin", "hermes"),
        "/usr/local/bin/hermes",
        "/opt/hermes/bin/hermes",
        join(home, ".hermes", "bin", "hermes"),
      ];

  for (const p of commonPaths) {
    if (p && existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Check if Hermes home directory exists and looks valid
 */
export async function checkHermesHomeValid(hermesHome: string): Promise<boolean> {
  if (!existsSync(hermesHome)) return false;

  try {
    const stats = await stat(hermesHome);
    if (!stats.isDirectory()) return false;

    // Check for config file or state.db or other Hermes markers
    for (const configFile of HERMES_CONFIG_FILES) {
      if (existsSync(join(hermesHome, configFile))) return true;
    }

    // Check for state.db, memories, skills directories
    const markers = ["state.db", "memories", "skills", ".env", "auth.json"];
    for (const marker of markers) {
      if (existsSync(join(hermesHome, marker))) return true;
    }

    // If directory exists but empty, still consider it as installed (user may have just created it)
    // But require at least the directory to exist
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to get Hermes version from executable
 */
export async function getHermesVersion(executablePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(executablePath, ["--version"], { timeout: 5000 });
    const version = stdout.trim().split("\n")[0]?.trim();
    return version || null;
  } catch {
    try {
      const { stdout } = await execFileAsync(executablePath, ["version"], { timeout: 5000 });
      return stdout.trim().split("\n")[0]?.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * Check if Hermes runtime/service is reachable via HTTP endpoint
 * Uses real Hermes architecture - checks local endpoints
 */
export async function checkHermesEndpoint(
  endpoint: string,
  timeoutMs = 3000
): Promise<{ reachable: boolean; version?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Try common Hermes health endpoints
    const healthPaths = ["/health", "/api/health", "/api/status", "/"];

    for (const healthPath of healthPaths) {
      try {
        const response = await fetch(`${endpoint}${healthPath}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeout);

        if (response.ok) {
          try {
            const data = (await response.json()) as { version?: string; status?: string };
            return { reachable: true, version: data.version };
          } catch {
            return { reachable: true };
          }
        }
      } catch {
        // Try next path
        continue;
      }
    }

    clearTimeout(timeout);
    return { reachable: false };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main detection function - determines Hermes state
 */
export async function detectHermes(
  options: HermesDetectionOptions = {}
): Promise<HermesDetectionResult> {
  const hermesHome = options.hermesHome || resolveHermesHome();
  const checkEndpoints = options.checkEndpoints ?? true;
  const timeoutMs = options.timeoutMs ?? 3000;

  // Step 1: Check if Hermes is installed (home dir exists or executable on PATH)
  const executablePath = await findHermesExecutable();
  const homeValid = hermesHome ? await checkHermesHomeValid(hermesHome) : false;

  if (!executablePath && !homeValid) {
    return {
      state: HERMES_CONNECTION_STATES.NOT_INSTALLED,
      hermesHome: hermesHome || undefined,
      detectedAt: new Date().toISOString(),
    };
  }

  // Step 2: Try to get version
  let version: string | undefined;
  if (executablePath) {
    const v = await getHermesVersion(executablePath);
    if (v) version = v;
  }

  // Also try reading version from config if available
  if (!version && hermesHome && existsSync(join(hermesHome, "config.yaml"))) {
    try {
      const configContent = await readFile(join(hermesHome, "config.yaml"), "utf-8");
      const match = configContent.match(/version:\s*["']?([^\s"']+)["']?/);
      if (match) version = match[1];
    } catch {
      // Ignore
    }
  }

  // Step 3: Check if Hermes is running (endpoint reachable)
  if (checkEndpoints) {
    for (const endpoint of HERMES_ENDPOINTS) {
      const result = await checkHermesEndpoint(endpoint, timeoutMs);
      if (result.reachable) {
        return {
          state: HERMES_CONNECTION_STATES.RUNNING,
          hermesHome: hermesHome || undefined,
          executablePath: executablePath || undefined,
          version,
          endpoint,
          detectedAt: new Date().toISOString(),
        };
      }
    }
  }

  // Step 4: Installed but not running
  return {
    state: HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING,
    hermesHome: hermesHome || undefined,
    executablePath: executablePath || undefined,
    version,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Detect Hermes with retry logic for reconnection scenarios
 */
export async function detectHermesWithRetry(
  options: HermesDetectionOptions & { retries?: number; retryDelayMs?: number } = {}
): Promise<HermesDetectionResult> {
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;

  let lastResult: HermesDetectionResult | null = null;

  for (let i = 0; i <= retries; i++) {
    const result = await detectHermes(options);
    lastResult = result;

    // If we found a running instance, return immediately
    if (
      result.state === HERMES_CONNECTION_STATES.RUNNING ||
      result.state === HERMES_CONNECTION_STATES.CONNECTED
    ) {
      return result;
    }

    // If not last attempt, wait before retry
    if (i < retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return lastResult!;
}

/**
 * Watch for Hermes installation changes (for Windows installer detection)
 */
export function watchHermesInstallation(
  callback: (result: HermesDetectionResult) => void,
  intervalMs = 5000
): () => void {
  let stopped = false;

  const check = async () => {
    if (stopped) return;
    try {
      const result = await detectHermes();
      callback(result);
    } catch {
      // Ignore errors in watch mode
    }
    if (!stopped) {
      setTimeout(check, intervalMs);
    }
  };

  // Start checking
  setTimeout(check, 1000);

  return () => {
    stopped = true;
  };
}
