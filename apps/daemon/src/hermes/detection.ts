/**
 * Hermes Detection - Daemon Side
 * Reuses same logic as desktop but for daemon process
 */

import { existsSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HermesConnectionState } from "./types.js";
import { HERMES_CONNECTION_STATES } from "./types.js";

const execFileAsync = promisify(execFile);

const HERMES_ENDPOINTS = [
  "http://127.0.0.1:18789",
  "http://127.0.0.1:18790",
  "http://127.0.0.1:3456",
  "http://localhost:18789",
];

export function resolveHermesHome(): string | null {
  const envHome = process.env.HERMES_HOME || process.env.HERMES_HOME_DIR;
  if (envHome && envHome.trim()) {
    return resolve(envHome.trim());
  }
  const home = homedir();
  if (platform() === "win32") {
    const candidates = [
      process.env.APPDATA ? join(process.env.APPDATA, "hermes") : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "hermes") : null,
      join(home, ".hermes"),
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return join(home, ".hermes");
  }
  return join(home, ".hermes");
}

export async function findHermesExecutable(): Promise<string | null> {
  const isWindows = platform() === "win32";
  const executableNames = isWindows ? ["hermes.exe", "hermes.cmd", "hermes"] : ["hermes"];
  try {
    const cmd = isWindows ? "where" : "which";
    for (const name of executableNames) {
      try {
        const { stdout } = await execFileAsync(cmd, [name], { timeout: 3000 });
        const found = stdout.split("\n")[0]?.trim();
        if (found && existsSync(found)) return found;
      } catch {}
    }
  } catch {}
  const home = homedir();
  const commonPaths = isWindows
    ? [
        join(home, ".local", "bin", "hermes.exe"),
        join(home, "AppData", "Local", "Programs", "hermes", "hermes.exe"),
      ]
    : [join(home, ".local", "bin", "hermes"), "/usr/local/bin/hermes"];
  for (const p of commonPaths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export async function checkHermesHomeValid(hermesHome: string): Promise<boolean> {
  if (!existsSync(hermesHome)) return false;
  try {
    const stats = await stat(hermesHome);
    if (!stats.isDirectory()) return false;
    const markers = ["config.yaml", "config.json", "state.db", "memories", "skills", ".env"];
    for (const marker of markers) {
      if (existsSync(join(hermesHome, marker))) return true;
    }
    return true;
  } catch {
    return false;
  }
}

export async function checkHermesEndpoint(endpoint: string, timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
            const data = (await response.json()) as { version?: string };
            return { reachable: true, version: data.version };
          } catch {
            return { reachable: true };
          }
        }
      } catch {
        continue;
      }
    }
    clearTimeout(timeout);
    return { reachable: false };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface HermesDetectionResult {
  state: HermesConnectionState;
  hermesHome?: string;
  executablePath?: string;
  version?: string;
  endpoint?: string;
  error?: string;
  detectedAt: string;
}

export async function detectHermes(): Promise<HermesDetectionResult> {
  const hermesHome = resolveHermesHome();
  const executablePath = await findHermesExecutable();
  const homeValid = hermesHome ? await checkHermesHomeValid(hermesHome) : false;

  if (!executablePath && !homeValid) {
    return { state: HERMES_CONNECTION_STATES.NOT_INSTALLED, hermesHome: hermesHome || undefined, detectedAt: new Date().toISOString() };
  }

  for (const endpoint of HERMES_ENDPOINTS) {
    const result = await checkHermesEndpoint(endpoint, 2000);
    if (result.reachable) {
      return {
        state: HERMES_CONNECTION_STATES.RUNNING,
        hermesHome: hermesHome || undefined,
        executablePath: executablePath || undefined,
        version: result.version,
        endpoint,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return {
    state: HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING,
    hermesHome: hermesHome || undefined,
    executablePath: executablePath || undefined,
    detectedAt: new Date().toISOString(),
  };
}
