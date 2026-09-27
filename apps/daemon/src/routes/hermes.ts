/**
 * Hermes Routes - Daemon Side
 * Implements Hermes integration endpoints
 * - Detection, status, context, actions, events, artifacts, theme, model, project
 */

import type { Express, Request, Response } from "express";
import { getHermesDaemonBridge } from "../hermes/bridge.js";
import { detectHermes } from "../hermes/detection.js";
import { HERMES_CONNECTION_STATES } from "../hermes/types.js";

interface HermesRouteDeps {
  db: any;
}

export function registerHermesRoutes(app: Express, deps: HermesRouteDeps) {
  const bridge = getHermesDaemonBridge();

  // GET /api/hermes/status - Current Hermes connection status
  app.get("/api/hermes/status", async (_req: Request, res: Response) => {
    try {
      const status = await bridge.status();
      res.json(status);
    } catch (error) {
      res.status(500).json({
        connectionState: HERMES_CONNECTION_STATES.NOT_INSTALLED,
        isConnected: false,
        isHermesInstalled: false,
        isHermesRunning: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/hermes/connect - Attempt to connect to Hermes
  app.post("/api/hermes/connect", async (_req: Request, res: Response) => {
    try {
      const status = await bridge.status();
      // If running, mark as connected
      if (status.connectionState === HERMES_CONNECTION_STATES.RUNNING) {
        const connectedStatus = {
          ...status,
          connectionState: HERMES_CONNECTION_STATES.CONNECTED,
          isConnected: true,
          lastConnectedAt: new Date().toISOString(),
        };
        res.json(connectedStatus);
      } else {
        res.json(status);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/hermes/disconnect - Disconnect from Hermes
  app.post("/api/hermes/disconnect", async (_req: Request, res: Response) => {
    try {
      const status = await bridge.status();
      res.json({
        ...status,
        connectionState: HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING,
        isConnected: false,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/hermes/reconnect - Reconnect to Hermes
  app.post("/api/hermes/reconnect", async (_req: Request, res: Response) => {
    try {
      const detection = await detectHermes();
      const status = await bridge.status();
      res.json({
        ...status,
        connectionState: detection.state,
        isConnected: detection.state === HERMES_CONNECTION_STATES.RUNNING,
        isHermesInstalled: detection.state !== HERMES_CONNECTION_STATES.NOT_INSTALLED,
        isHermesRunning: detection.state === HERMES_CONNECTION_STATES.RUNNING,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/hermes/detect - Detailed detection
  app.get("/api/hermes/detect", async (_req: Request, res: Response) => {
    try {
      const result = await detectHermes();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/hermes/context - Shared context
  app.get("/api/hermes/context", async (_req: Request, res: Response) => {
    try {
      const context = bridge.context();
      res.json(context);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // PUT /api/hermes/context - Update shared context
  app.put("/api/hermes/context", async (req: Request, res: Response) => {
    try {
      const partial = req.body as Record<string, unknown>;
      bridge.setContext(partial as any);
      res.json(bridge.context());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/hermes/capabilities - Hermes capabilities
  app.get("/api/hermes/capabilities", async (_req: Request, res: Response) => {
    res.json({
      supportsChatInvocation: true,
      supportsArtifactSharing: true,
      supportsProjectSync: true,
      supportsModelSync: true,
      supportsThemeSync: true,
      supportsMemory: true,
      supportsPermissions: true,
      supportsSendToCode: true,
      version: "1.0.0",
    });
  });

  // GET /api/hermes/theme - Current theme
  app.get("/api/hermes/theme", async (_req: Request, res: Response) => {
    const status = await bridge.status();
    // Return Hermes Design Studio default theme
    res.json({
      id: "hermes-design-studio-default",
      name: "Hermes Design Studio",
      mode: "light",
      colors: {
        primary: "#0000F2",
        light: "#F5F5F5",
        white: "#FFFFFF",
        accent: "#EDFF45",
        supporting: [
          "#0000D9",
          "#1A1AFF",
          "#000099",
          "#0000CC",
          "#3333FF",
          "#E9ECEF",
          "#D0D0D0",
          "#A0A0A0",
          "#FF4444",
          "#FF8888",
        ],
      },
      typography: {
        display: "Sigurd",
        ui: "Rules",
        technical: "Courier Prime",
      },
      hermesGlobalTheme: status.context?.themeId ? { id: status.context.themeId, name: "Hermes Global" } : undefined,
    });
  });

  // GET /api/hermes/model - Current model
  app.get("/api/hermes/model", async (_req: Request, res: Response) => {
    const context = bridge.context();
    res.json({
      id: context.modelId || "default",
      label: context.modelId || "Default Model",
      provider: "hermes",
    });
  });

  // GET /api/hermes/project - Current project
  app.get("/api/hermes/project", async (_req: Request, res: Response) => {
    const context = bridge.context();
    if (!context.hermesProjectId) {
      res.status(404).json({ error: "No current Hermes project" });
      return;
    }
    res.json({
      id: context.hermesProjectId,
      name: `Hermes Project ${context.hermesProjectId}`,
      workspaceId: context.workspaceId,
    });
  });

  // GET /api/hermes/artifacts - Shared artifacts
  app.get("/api/hermes/artifacts", async (_req: Request, res: Response) => {
    try {
      const context = bridge.context();
      // Query artifacts from DB that are shared with Hermes
      const artifacts = deps.db
        .prepare(
          `
        SELECT id, project_id as projectId, type, version, status, metadata, created_at as createdAt, updated_at as updatedAt
        FROM artifacts
        WHERE project_id = ? OR id IN (${context.artifactIds?.map(() => "?").join(",") || "''"})
        ORDER BY updated_at DESC
        LIMIT 100
      `
        )
        .all(context.hermesProjectId, ...(context.artifactIds || [])) as any[];

      res.json(
        artifacts.map((a: any) => ({
          id: a.id,
          projectId: a.projectId,
          type: a.type,
          version: a.version || 1,
          status: a.status || "ready",
          metadata: a.metadata ? JSON.parse(a.metadata) : {},
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          source: "design-studio",
          moduleOwnership: "shared",
        }))
      );
    } catch (error) {
      // Fallback if artifacts table doesn't exist or query fails
      res.json([]);
    }
  });

  // POST /api/hermes/actions - Execute Design Studio action from Hermes
  app.post("/api/hermes/actions", async (req: Request, res: Response) => {
    try {
      const action = req.body as {
        type: string;
        id: string;
        payload?: unknown;
        context?: Record<string, unknown>;
      };

      if (!action.type || !action.id) {
        res.status(400).json({ error: "Action must have type and id" });
        return;
      }

      // Validate action type
      const validActions = [
        "designStudio.open",
        "designStudio.close",
        "designStudio.focus",
        "designStudio.create",
        "designStudio.edit",
        "designStudio.generate",
        "designStudio.generateVariant",
        "designStudio.preview",
        "designStudio.compare",
        "designStudio.export",
        "designStudio.approve",
        "designStudio.pause",
        "designStudio.resume",
        "designStudio.cancel",
        "designStudio.getStatus",
        "designStudio.getArtifacts",
        "designStudio.sendToCode",
      ];

      if (!validActions.includes(action.type)) {
        res.status(400).json({ error: `Invalid action type: ${action.type}` });
        return;
      }

      // For now, return success - actual execution happens in desktop/web
      // This endpoint is the contract that Hermes can call
      res.json({
        actionId: action.id,
        type: action.type,
        success: true,
        data: {
          message: `Action ${action.type} received`,
          payload: action.payload,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/hermes/events - SSE stream of Design Studio events
  app.get("/api/hermes/events", async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Send initial status
    try {
      const status = await bridge.status();
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    } catch {}

    // Keep alive
    const interval = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 15000);

    // Listen for status changes
    const unsubscribe = bridge.onStatusChange((status) => {
      try {
        res.write(`data: ${JSON.stringify(status)}\n\n`);
      } catch {}
    });

    req.on("close", () => {
      clearInterval(interval);
      unsubscribe();
      res.end();
    });
  });

  // POST /api/design-studio/events - Receive events from Design Studio (for forwarding to Hermes)
  app.post("/api/design-studio/events", async (req: Request, res: Response) => {
    try {
      const event = req.body;
      // Log event and optionally forward to Hermes if connected
      console.log(`[Design Studio Event] ${event.type}: ${event.id}`);

      // If Hermes is connected, forward the event
      const status = await bridge.status();
      if (status.isConnected && status.context?.hermesHome) {
        // Try to forward to Hermes endpoint
        // This is best effort - Hermes may not have this endpoint yet
        try {
          const detection = await detectHermes();
          if (detection.endpoint) {
            await fetch(`${detection.endpoint}/api/design-studio/events`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
            }).catch(() => {});
          }
        } catch {}
      }

      res.json({ ok: true, received: event.id });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/hermes/send-to-code - Design -> Code handoff contract
  app.post("/api/hermes/send-to-code", async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        projectId: string;
        designId: string;
        artifactId?: string;
        metadata?: Record<string, unknown>;
        assets?: string[];
        designIntent?: string;
        variant?: string;
      };

      if (!payload.projectId || !payload.designId) {
        res.status(400).json({ error: "projectId and designId required" });
        return;
      }

      const handoff = {
        projectId: payload.projectId,
        designId: payload.designId,
        artifactId: payload.artifactId,
        selectedDesign: {
          id: payload.designId,
          metadata: payload.metadata,
        },
        relevantMetadata: payload.metadata,
        relevantAssets: payload.assets?.map((a) => ({ path: a, type: "asset" })) || [],
        designIntent: payload.designIntent,
        variant: payload.variant,
        context: bridge.context(),
        timestamp: new Date().toISOString(),
      };

      // If Hermes is connected, forward to Hermes Code
      const status = await bridge.status();
      if (status.isConnected) {
        try {
          const detection = await detectHermes();
          if (detection.endpoint) {
            const hermesResponse = await fetch(`${detection.endpoint}/api/code/handoff`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(handoff),
            }).catch(() => null);

            if (hermesResponse?.ok) {
              const result = await hermesResponse.json();
              res.json({ ok: true, handoff, hermesResult: result });
              return;
            }
          }
        } catch {}
      }

      // Return handoff contract even if Hermes not connected
      res.json({ ok: true, handoff, message: "Handoff contract ready, Hermes Code will process when connected" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/hermes/deeplink - Parse and validate deep links
  app.get("/api/hermes/deeplink", async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "url query param required" });
      return;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "hermes:") {
        res.status(400).json({ error: "Invalid protocol, must be hermes://" });
        return;
      }

      // Parse hermes://design-studio/* links
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const host = parsed.host; // design-studio

      if (host !== "design-studio") {
        res.status(400).json({ error: "Invalid host, must be design-studio" });
        return;
      }

      let type = "design-studio";
      let id: string | undefined;

      if (pathParts[0] === "project" && pathParts[1]) {
        type = "project";
        id = pathParts[1];
      } else if (pathParts[0] === "design" && pathParts[1]) {
        type = "design";
        id = pathParts[1];
      } else if (pathParts[0] === "artifact" && pathParts[1]) {
        type = "artifact";
        id = pathParts[1];
      } else if (pathParts[0] === "session" && pathParts[1]) {
        type = "session";
        id = pathParts[1];
      }

      res.json({
        type,
        id,
        path: parsed.pathname,
        originalUrl: url,
        params: Object.fromEntries(parsed.searchParams.entries()),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
