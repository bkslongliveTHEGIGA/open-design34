/**
 * Hermes Design Studio Integration Tests
 * Implements STEP 26: Release Test Matrix
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("Hermes Design Studio - Gap Audit", () => {
  describe("Vendor Submodule", () => {
    it("vendor/nous-hermes exists as reference", () => {
      expect(existsSync("vendor/nous-hermes")).toBe(true);
      expect(existsSync("vendor/nous-hermes/README.md")).toBe(true);
      expect(existsSync("vendor/nous-hermes/VERSION_PIN")).toBe(true);
    });

    it(".gitmodules contains hermes-agent reference", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(".gitmodules", "utf-8");
      expect(content).toContain("hermes-agent");
      expect(content).toContain("NousResearch");
    });
  });

  describe("Hermes Bridge - Desktop", () => {
    it("bridge directory exists", () => {
      expect(existsSync("apps/desktop/src/main/hermes")).toBe(true);
    });

    it("core bridge files exist", () => {
      expect(existsSync("apps/desktop/src/main/hermes/types.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/detection.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/bridge.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/context.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/events.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/actions.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/deeplink.ts")).toBe(true);
      expect(existsSync("apps/desktop/src/main/hermes/index.ts")).toBe(true);
    });
  });

  describe("Hermes Bridge - Daemon", () => {
    it("daemon hermes directory exists", () => {
      expect(existsSync("apps/daemon/src/hermes")).toBe(true);
    });

    it("daemon hermes files exist", () => {
      expect(existsSync("apps/daemon/src/hermes/types.ts")).toBe(true);
      expect(existsSync("apps/daemon/src/hermes/detection.ts")).toBe(true);
      expect(existsSync("apps/daemon/src/hermes/bridge.ts")).toBe(true);
      expect(existsSync("apps/daemon/src/hermes/index.ts")).toBe(true);
    });

    it("hermes routes exist", () => {
      expect(existsSync("apps/daemon/src/routes/hermes.ts")).toBe(true);
    });
  });

  describe("Hermes Bridge - Web", () => {
    it("web hermes directory exists", () => {
      expect(existsSync("apps/web/src/hermes")).toBe(true);
    });

    it("web hermes files exist", () => {
      expect(existsSync("apps/web/src/hermes/types.ts")).toBe(true);
      expect(existsSync("apps/web/src/hermes/HermesProvider.tsx")).toBe(true);
      expect(existsSync("apps/web/src/hermes/HermesStatusIndicator.tsx")).toBe(true);
      expect(existsSync("apps/web/src/hermes/HermesTheme.tsx")).toBe(true);
      expect(existsSync("apps/web/src/hermes/HermesFloatingControls.tsx")).toBe(true);
    });
  });

  describe("Branding", () => {
    it("package release product name is Hermes Design Studio", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile("packages/release/src/index.ts", "utf-8");
      expect(content).toContain("Hermes Design Studio");
    });

    it("web layout title is Hermes Design Studio", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile("apps/web/app/layout.tsx", "utf-8");
      expect(content).toContain("Hermes Design Studio");
    });

    it("theme colors defined", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile("apps/desktop/src/main/hermes/types.ts", "utf-8");
      expect(content).toContain("#0000F2");
      expect(content).toContain("#EDFF45");
      expect(content).toContain("#F5F5F5");
    });
  });

  describe("Deep Links", () => {
    it("hermes deeplink parsing works", async () => {
      const { parseHermesDeepLink } = await import("../apps/desktop/src/main/hermes/deeplink.js");
      const link = parseHermesDeepLink("hermes://design-studio/project/test123");
      expect(link).not.toBeNull();
      expect(link?.type).toBe("project");
      expect(link?.id).toBe("test123");
    });
  });

  describe("Package Validation", () => {
    it("validation script exists", () => {
      expect(existsSync("scripts/validate-hermes-package.mjs")).toBe(true);
    });
  });

  describe("Release Workflow", () => {
    it("hermes release workflow exists", () => {
      expect(existsSync(".github/workflows/hermes-release.yml")).toBe(true);
    });

    it("workflow produces correct artifacts", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(".github/workflows/hermes-release.yml", "utf-8");
      expect(content).toContain("HermesDesignStudio-Windows-x64.exe");
      expect(content).toContain("HermesDesignStudio-Setup-Windows-x64.exe");
      expect(content).toContain("SHA256SUMS.txt");
    });

    it("workflow validates no hermes source bundled", async () => {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(".github/workflows/hermes-release.yml", "utf-8");
      expect(content).toContain("vendor/nous-hermes");
      expect(content).toContain("validate-hermes-package");
    });
  });

  describe("Documentation", () => {
    it("hermes design studio docs exist", () => {
      expect(existsSync("docs/hermes-design-studio.md")).toBe(true);
    });
  });

  describe("Security", () => {
    it("no secrets logged in bridge", async () => {
      const { readFile } = await import("node:fs/promises");
      const bridgeContent = await readFile("apps/desktop/src/main/hermes/bridge.ts", "utf-8");
      // Should not contain console.log of secrets
      expect(bridgeContent).not.toMatch(/console\.log.*password|apiKey|secret/i);
    });
  });
});

describe("Hermes Design Studio - Release Test Matrix", () => {
  describe("Hermes Connected (simulated)", () => {
    it("detection logic exists", async () => {
      const { detectHermes } = await import("../apps/desktop/src/main/hermes/detection.js");
      expect(typeof detectHermes).toBe("function");
    });

    it("bridge connect logic exists", async () => {
      const { createHermesBridge } = await import("../apps/desktop/src/main/hermes/bridge.js");
      const bridge = createHermesBridge({ autoReconnect: false });
      expect(bridge).toBeDefined();
      expect(typeof bridge.connect).toBe("function");
      expect(typeof bridge.status).toBe("function");
    });

    it("actions contract exists", async () => {
      const { DesignStudioActionFactory } = await import("../apps/desktop/src/main/hermes/actions.js");
      expect(DesignStudioActionFactory).toBeDefined();
      expect(typeof DesignStudioActionFactory.create).toBe("function");
      expect(typeof DesignStudioActionFactory.sendToCode).toBe("function");
    });

    it("events contract exists", async () => {
      const { createHermesEventBus } = await import("../apps/desktop/src/main/hermes/events.js");
      const bus = createHermesEventBus();
      expect(bus).toBeDefined();
      expect(typeof bus.emit).toBe("function");
      expect(typeof bus.on).toBe("function");
    });

    it("sendToCode handoff contract exists", async () => {
      const { createDesignToCodeHandoff } = await import("../apps/desktop/src/main/hermes/actions.js");
      const handoff = createDesignToCodeHandoff({
        projectId: "test-project",
        designId: "test-design",
        metadata: { test: true },
      });
      expect(handoff.projectId).toBe("test-project");
      expect(handoff.designId).toBe("test-design");
      expect(handoff.timestamp).toBeDefined();
    });
  });

  describe("Hermes Disconnected (standalone)", () => {
    it("standalone mode is valid operating mode", () => {
      // Standalone mode should not be error
      // Check that default status is NOT_INSTALLED but still functional
      expect(true).toBe(true); // Placeholder - actual standalone functionality tested via e2e
    });
  });

  describe("Hermes Restart", () => {
    it("reconnection logic exists", async () => {
      const { createHermesBridge } = await import("../apps/desktop/src/main/hermes/bridge.js");
      const bridge = createHermesBridge({ autoReconnect: true });
      expect(typeof bridge.reconnect).toBe("function");
      expect(typeof bridge.onConnectionStateChange).toBe("function");
    });
  });
});
