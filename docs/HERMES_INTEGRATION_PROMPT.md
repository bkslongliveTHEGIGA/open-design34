# HERMES Integration Prompt – Quick Copy

## For AI Agent – Copy Everything Below

```
You are integrating Hermes Design Studio (bkslongliveTHEGIGA/open-design34) with Nous Hermes Agent (https://github.com/NousResearch/hermes-agent).

CURRENT STATE:
- Repo already has bridge at apps/desktop/src/main/hermes/ (types, detection, bridge, context, events, actions, deeplink)
- Release workflow produces real Electron: v1.0.19 has 438MB Setup + 223MB Portable (verified via API sizes, build-dir.log shows portable 483MB zip, installer 438MB)
- Fix applied: tools/pack/src/win/payload.ts now uses PRODUCT_NAME="Hermes Design Studio" not "Open Design.exe"
- Workflow now on main branch, TrimStart('v') fix for electron-builder
- Branding #0000F2 #F5F5F5 #FFFFFF #EDFF45, fonts Sigurd/Rules/Courier Prime, docs at docs/hermes-design-studio.md
- vendor/nous-hermes is pinned submodule placeholder, validation fails if bundled

GAP:
- detection.ts checks fake endpoints 127.0.0.1:18789/18790/3456. Real Hermes uses 8642 (API_SERVER_ENABLED) + tui_gateway JSON-RPC (server.py + methods_*.py)
- Bridge not wired to real Hermes context

TASK:
1. git submodule update --init --depth 1 vendor/nous-hermes – inspect hermes_constants.py:get_hermes_home(), tui_gateway/server.py, apps/desktop/ (Electron + apps/shared JSON-RPC client), hermes_cli/web_routers/, gateway/run.py

2. Fix detection.ts:
   - resolveHermesHome(): HERMES_HOME env, %APPDATA%/hermes, %LOCALAPPDATA%/hermes, ~/.hermes, C:/Program Files/Hermes, get_hermes_home() logic
   - findHermesExecutable(): hermes.exe/hermes on PATH + common paths
   - checkHermesHomeValid(): config.yaml, state.db, memories/, skills/, SOUL.md, .env, auth.json
   - checkHermesEndpoint(): http://127.0.0.1:8642, http://localhost:8642, /health, /api/health, /api/status, /
   - States: NOT_INSTALLED, INSTALLED_NOT_RUNNING, RUNNING, CONNECTED, CONNECTION_LOST, RECONNECTING

3. Bridge at apps/desktop/src/main/hermes/:
   - bridge.ts: singleton, detect(), connect(), disconnect(), reconnect(), status(), capabilities(), context(), model(), theme(), project(), artifacts(), events(), permissions(), start(), stop(), onStatusChange(), auto-reconnect 5s max 50 attempts
   - context.ts: store + adaptHermesContextFromUpstream() mapping real Hermes context to HermesSharedContext {hermesProjectId, workspaceId, conversationId, taskId, agentSessionId, modelId, themeId, memoryContextId, artifactIds, permissionContextId, hermesHome, profile, updatedAt}
   - events.ts: bus + forwarder POST /api/design-studio/events
   - actions.ts: registry for designStudio.open/close/focus/create/edit/generate/generateVariant/preview/compare/export/approve/pause/resume/cancel/getStatus/getArtifacts/sendToCode
   - deeplink.ts: validate hermes://design-studio/... regex ^[A-Za-z0-9._-]{1,128}$, protocol hermes:, host design-studio, register app.setAsDefaultProtocolClient("hermes")

4. Daemon:
   - POST /api/hermes/actions – Hermes → Design Studio
   - GET /api/hermes/events SSE
   - GET /api/hermes/artifacts
   - POST /api/hermes/send-to-code with DesignToCodeHandoff {projectId, designId, artifactId?, selectedDesign {id,name?,html?,metadata?}, relevantMetadata?, relevantAssets? [{path,type,url?}], designIntent?, variant?, context?, timestamp}

5. Web:
   - HermesProvider.tsx useHermes() hook isConnected/isStandalone
   - HermesFloatingControls.tsx real actions, floatIn/pulse animation, progress, preview

6. Security: no passwords/cookies/API keys/OAuth to renderer, no secrets logged, respect permissions, validate IDs

7. Installer: must NOT bundle vendor/nous-hermes, NOT install Hermes, must detect/connect automatically, show clear state, remain usable standalone, reconnect without restart. Already produces real exe 223MB/438MB.

8. Test:
   - hermes gateway start --api-server-enabled true
   - curl http://127.0.0.1:8642/health
   - pnpm --filter @open-design/desktop dev – should CONNECTED, sync theme/model/project
   - Hermes Chat "Create homepage for PartForge" → designStudio.create → progress/preview/artifact
   - Stop gateway → CONNECTION_LOST → continues → auto-reconnects → resync
   - Unset HERMES_HOME, stop gateway → NOT_INSTALLED → Standalone functional

DO NOT: invent fake endpoints, require API key for local, bundle vendor, expose secrets, show fake Hermes state when disconnected, claim build success unless exe >1MB MZ header.

Deliver: updated hermes/*.ts wired to real 8642 + tui_gateway, daemon endpoints, web provider, deep links, validation, docs.
```

## How to Use

1. Copy the prompt block above
2. Paste into Claude Code, Cursor, Windsurf, or any AI agent with access to both repos
3. Agent should first run `git submodule update --init --depth 1 vendor/nous-hermes` to fetch real Hermes source
4. Then implement the 8 steps
5. Verify with `hermes gateway start --api-server-enabled` + Design Studio dev mode

## Why This Prompt?

- v1.0.19 already has **real Electron installer** (438MB Setup, 223MB Portable) – fixes "This app can't run on your PC" (v1.0.5 had 8704B placeholder)
- Remaining gap is **wiring bridge to real Nous Hermes Agent** endpoints (8642 API + tui_gateway JSON-RPC) instead of placeholder 18789
- This prompt gives exact file paths, real Hermes architecture (from upstream AGENTS.md), and test steps

## Quick Reference – Real Hermes Agent

- HERMES_HOME: `~/.hermes` or `%APPDATA%\hermes`, env var `HERMES_HOME`, contains `config.yaml`, `state.db`, `memories/`, `skills/`, `SOUL.md`
- API Server: port 8642 when `API_SERVER_ENABLED=true`, health at `/health`
- TUI Gateway: `tui_gateway/server.py` JSON-RPC, methods in `methods_*.py`, used by both TUI and Desktop via `apps/shared` client
- Gateway: `gateway/run.py`, 20 platform adapters, supervised, profile isolation `hermes -p <name>`
- Desktop: `apps/desktop/` Electron reference

## Current Release

- v1.0.19: https://github.com/bkslongliveTHEGIGA/open-design34/releases/tag/v1.0.19
- Setup 438MB, Portable 223MB, SHA256SUMS, build logs included
- Build log shows: portable 483MB zip (1229 MiB unpacked), installer 438MB, payload 340MB base + 78MB overlay
- Fix: `payload.ts` now uses `PRODUCT_NAME` not hardcoded `Open Design.exe`
