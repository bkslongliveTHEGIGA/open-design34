# HERMES DESIGN STUDIO ↔ NOUS HERMES AGENT – INTEGRATION PROMPT

> **Use this prompt with any AI coding agent (Claude, GPT, Gemini, etc.) to complete the integration between Hermes Design Studio (this repo) and Nous Hermes Agent (https://github.com/NousResearch/hermes-agent).**
> Copy the entire prompt block below and paste into your agent.

---

## MASTER PROMPT START

You are integrating **Hermes Design Studio** (fork of OpenDesign at `bkslongliveTHEGIGA/open-design34`) with **Nous Hermes Agent** (`https://github.com/NousResearch/hermes-agent`).

### Context

**Hermes Design Studio** is a professional design environment that should run as a first-class capability inside the Hermes ecosystem. It already has:

- Electron desktop app at `apps/desktop/`
- Web app at `apps/web/`
- Daemon at `apps/daemon/`
- Bridge layer at `apps/desktop/src/main/hermes/` (detection, bridge, context, events, actions, deeplink)
- Release workflow at `.github/workflows/hermes-release.yml` producing 438MB Setup + 223MB Portable (v1.0.19 verified real Electron)
- Branding #0000F2 #F5F5F5 #FFFFFF #EDFF45, fonts Sigurd/Rules/Courier Prime
- Docs at `docs/hermes-design-studio.md`

**Nous Hermes Agent** real architecture (from upstream):

```
hermes-agent/
├── run_agent.py              # AIAgent core loop
├── cli.py                    # HermesCLI
├── hermes_state.py           # SQLite session DB + FTS5
├── hermes_constants.py       # get_hermes_home() – profile-aware paths, HERMES_HOME env
├── hermes_logging.py         # agent.log / gateway.log profile-aware
├── agent/                    # prompt_builder, context_compressor, providers
├── hermes_cli/               # config, setup, auth, web_routers/ (dashboard FastAPI routers)
│   └── web_routers/          # One per surface, mounted by web_server.py
├── tools/                    # self-registering tools, registry.py, terminal_tool, file_operations, etc.
├── gateway/                  # run.py GatewayRunner, session.py, platforms/ (telegram, discord, slack, whatsapp)
├── tui_gateway/              # Python JSON-RPC backend for TUI + Desktop – server.py + methods_*.py
├── apps/desktop/             # Electron desktop app + apps/shared JSON-RPC client
├── ui-tui/                   # Ink React TUI – hermes --tui
├── acp_adapter/              # ACP server for VS Code/Zed/JetBrains
├── plugins/                  # memory/, context_engine/, model-providers/, etc.
├── skills/                   # bundled skills → ~/.hermes/skills/
└── website/                  # docs
```

Key real Hermes facts:
- **Profile isolation**: Each `hermes -p <name>` gets own HERMES_HOME, config, memory, sessions, gateway PID. Multiple profiles concurrent.
- **HERMES_HOME**: Resolved via `hermes_constants.py:get_hermes_home()` – respects `HERMES_HOME` env var, defaults to `~/.hermes` (or `%APPDATA%/hermes` on Windows). Contains `config.yaml`, `state.db`, `memories/`, `skills/`, `SOUL.md`.
- **Gateway**: Long-running process with 20 platform adapters, `gateway/run.py`, supervised. Optional API server on port **8642** (not 18789) when `API_SERVER_ENABLED=true`, exposes OpenAI-compatible API + health endpoint. Dashboard on 9119.
- **TUI Gateway**: JSON-RPC backend at `tui_gateway/server.py` with methods in `methods_*.py` – used by both TUI and Desktop.
- **Desktop**: Electron at `apps/desktop/` uses `apps/shared` JSON-RPC client to talk to tui_gateway.
- **Design Principle**: Surface capability is property of SESSION, never process env. Toolset is surface gate. One AIAgent serves CLI, gateway, ACP, batch, API.

### Current Gap

Our current detection in `apps/desktop/src/main/hermes/detection.ts` checks fake endpoints `127.0.0.1:18789/18790/3456`. Real Hermes uses **8642** for API server + **tui_gateway** JSON-RPC over stdio or TCP, not HTTP 18789. Also we don't inspect real `vendor/nous-hermes` source (currently placeholder).

We have bridge types but need to wire to **real** Hermes interfaces.

### Your Task – 30 Steps

**1. Audit**
- Read `docs/hermes-design-studio.md`
- List files in `apps/desktop/src/main/hermes/`
- Check `vendor/nous-hermes/` – run `git submodule update --init --depth 1 vendor/nous-hermes` to fetch real source
- Inspect `hermes_constants.py`, `tui_gateway/server.py`, `apps/desktop/`, `hermes_cli/web_routers/`, `gateway/run.py`

**2. Vendor Pin**
- Ensure `.gitmodules` has `[submodule "vendor/nous-hermes"] path=vendor/nous-hermes url=https://github.com/NousResearch/hermes-agent.git`
- Create `vendor/nous-hermes/VERSION_PIN` JSON with repo, branch, pinned_at, commit SHA
- Validation script `scripts/validate-hermes-package.mjs` must FAIL if `vendor/nous-hermes` found in `win-unpacked` or `dist`

**3. Discovery – Fix to Real Hermes**
- Update `detection.ts`:
  - `resolveHermesHome()`: Use `HERMES_HOME` env, then `%APPDATA%/hermes`, `%LOCALAPPDATA%/hermes`, `~/.hermes`, `C:/Program Files/Hermes`, plus `get_hermes_home()` logic from upstream
  - `findHermesExecutable()`: Check `hermes`, `hermes.exe`, `hermes.cmd` on PATH, plus common paths
  - `checkHermesHomeValid()`: Check for `config.yaml`, `state.db`, `memories/`, `skills/`, `SOUL.md`, `.env`, `auth.json`
  - `checkHermesEndpoint()`: Check real endpoints: `http://127.0.0.1:8642` (API server), `http://localhost:8642`, plus tui_gateway JSON-RPC availability. Try `/health`, `/api/health`, `/api/status`, `/`
  - States: `NOT_INSTALLED`, `INSTALLED_NOT_RUNNING`, `RUNNING`, `CONNECTED`, `CONNECTION_LOST`, `RECONNECTING`
  - No fake endpoints, no API key required for local

**4. Bridge – apps/desktop/src/main/hermes/**
- Types in `types.ts` already defined – keep but adapt to real Hermes:
  - `HermesSharedContext`: hermesProjectId, workspaceId, conversationId, taskId, agentSessionId, modelId, themeId, memoryContextId, artifactIds, permissionContextId, hermesHome, profile, updatedAt
  - `HermesCapabilities`, `HermesModelInfo`, `HermesTheme` (brand #0000F2), `HermesProject`, `HermesArtifact`, `HermesPermissions`
  - Actions: `designStudio.open/close/focus/create/edit/generate/generateVariant/preview/compare/export/approve/pause/resume/cancel/getStatus/getArtifacts/sendToCode`
  - Events: `design.created/updated/variant.created/preview.ready/agent.started/progress/completed/failed/export.completed/artifact.created/updated/approved/review.requested/sent_to_code`
- Implement:
  - `bridge.ts`: Singleton, `detect()`, `connect()`, `disconnect()`, `reconnect()`, `status()`, `capabilities()`, `context()`, `model()`, `theme()`, `project()`, `artifacts()`, `events()`, `permissions()`, `start()`, `stop()`, `onStatusChange()`, auto-reconnect every 5s, max 50 attempts
  - `context.ts`: Context store, `adaptHermesContextFromUpstream()` to map real Hermes context, project/model/theme sync, `HERMES_DESIGN_STUDIO_THEME` with brand palette
  - `events.ts`: Event bus + forwarder to Hermes via `POST /api/design-studio/events` or tui_gateway JSON-RPC
  - `actions.ts`: Registry for incoming actions from Hermes Chat
  - `detection.ts`: As above
  - `deeplink.ts`: Validate `hermes://design-studio/...` with regex `^[A-Za-z0-9._-]{1,128}$`, protocol `hermes:`, host `design-studio`, register via `app.setAsDefaultProtocolClient("hermes")`

**5. Daemon Integration**
- `apps/daemon/src/hermes/` or `apps/daemon/src/integrations/hermes/` – mirror bridge for daemon process
- Endpoints:
  - `POST /api/hermes/actions` – Hermes → Design Studio actions
  - `GET /api/hermes/events` SSE – Design Studio → Hermes events
  - `POST /api/design-studio/events` – forward events
  - `GET /api/hermes/artifacts` – shared artifacts
  - `GET /api/hermes/deeplink?url=...`
  - `POST /api/hermes/send-to-code` – typed handoff

**6. Web Integration**
- `apps/web/src/hermes/HermesProvider.tsx` – React provider using `useHermes()` hook, shows `isConnected`, `isStandalone`, status
- `apps/web/src/hermes/HermesFloatingControls.tsx` – Floating ecosystem UX when invoked from Hermes, real actions, not decorative

**7. Chat Invocation**
- When Hermes Chat says “Create a homepage for PartForge”, Hermes should call `designStudio.create` via bridge
- Design Studio returns progress, previews, artifacts, errors, completion visible in Hermes Chat

**8. Artifacts**
- Stable IDs, project association, version, metadata, preview, status draft/ready/approved/archived, source hermes/design-studio, moduleOwnership hermes/design-studio/shared
- Local storage when standalone, sync only authorized when connected

**9. Project/Memory/Model/Theme Sync**
- Hermes authoritative when connected: model, project, workspace, conversation, memory, permissions, agent session, theme, settings, artifacts, task
- No fake Hermes state when disconnected – show Standalone mode, not error
- Theme sync: Hermes global theme → Design Studio CSS vars, default #0000F2 when standalone

**10. Branding**
- App title, title bar, onboarding, splash pixel-scan #0000F2, menus, settings, command palette, empty states, dialogs, package metadata, updater, installer, icons, shortcuts → “Hermes Design Studio”
- Keep upstream license attribution

**11. Security**
- No passwords, cookies, API keys, OAuth tokens, secrets to renderer or model
- No secrets logged
- No public unauthenticated Hermes control endpoints
- Respect Hermes permissions
- Validate deep link IDs, path validation for shell.openPath

**12. sendToCode Contract**
```ts
interface DesignToCodeHandoff {
  projectId: string;
  designId: string;
  artifactId?: string;
  selectedDesign: { id, name?, html?, metadata? };
  relevantMetadata?: Record<string, unknown>;
  relevantAssets?: Array<{ path, type, url? }>;
  designIntent?: string;
  variant?: string;
  context?: HermesSharedContext;
  timestamp: string;
}
```

**13. Installer**
- Must NOT bundle `vendor/nous-hermes`, NOT install Hermes, NOT replace Hermes
- MUST detect/connect automatically, show clear state, remain usable standalone, reconnect without restart
- Product name `Hermes Design Studio`, App ID `io.hermes.design-studio`, exe `Hermes Design Studio.exe`

**14. Release Workflow**
- `.github/workflows/hermes-release.yml` already produces 438MB Setup + 223MB Portable (v1.0.19) – keep but ensure it searches `RUNNER_TEMP/tools-pack` and `.tmp/tools-pack` for real exe >1MB, copies to `release-artifacts/`, generates `SHA256SUMS.txt`, uses GitHub-native artifacts, no Nexu-only secrets
- Fix: `$rawVersion.TrimStart('v')` for electron-builder, `PRODUCT_NAME` usage in `payload.ts`

**15. Tests**
- `apps/desktop/src/main/hermes/__tests__/detection.test.ts` – test all 6 states, HERMES_HOME, Windows paths, PATH, endpoint reachable
- Validate package test, smoke test for exe exists

**16. Final Gap Audit + DoD**
- Document all in `docs/hermes-design-studio.md`
- Checklist: Connected mode works, Standalone works, Reconnect works, sendToCode works, no secrets, branding correct, installer valid PE, validation fails if vendor bundled, Windows x64 exe downloadable

### How to Test Integration Locally

1. Install Hermes Agent:
```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh
# or
git clone https://github.com/NousResearch/hermes-agent
cd hermes-agent
pip install -e .
hermes setup
hermes gateway start --api-server-enabled true
# Check endpoint
curl http://127.0.0.1:8642/health
```

2. Set HERMES_HOME:
```bash
export HERMES_HOME=$HOME/.hermes
# Windows
set HERMES_HOME=%APPDATA%\hermes
```

3. Run Hermes Design Studio in dev:
```bash
pnpm install
pnpm --filter @open-design/desktop dev
# Should auto-detect Hermes, show CONNECTED, sync theme/model/project
```

4. Test actions from Hermes Chat:
- In Hermes TUI or gateway, say “Create a homepage for PartForge”
- Should trigger designStudio.create, show floating controls, progress, preview

5. Test standalone:
```bash
unset HERMES_HOME
# Stop gateway
hermes gateway stop
# Launch Design Studio – should show Standalone mode, still functional
```

6. Test reconnection:
- Start Design Studio standalone
- Start Hermes gateway
- Should auto-reconnect in 5s, resync state

7. Build installer:
```bash
pnpm exec tools-pack win build --dir $RUNNER_TEMP/tools-pack --namespace hermes-1.0.0 --portable --app-version 1.0.0 --to all --json
# Check for real exe >1MB in $RUNNER_TEMP/tools-pack/out/win/namespaces/hermes-1.0.0/builder/
```

### Deliverables

- Updated `apps/desktop/src/main/hermes/*.ts` wired to real Hermes
- Updated `detection.ts` with real endpoints 8642 + tui_gateway JSON-RPC
- Daemon endpoints for actions/events/artifacts
- Web provider + floating controls
- Deep links working
- Package validation
- Release workflow producing real exe (already done in v1.0.19)
- Docs updated
- No secrets exposed

### Do NOT

- Invent fake Hermes endpoints
- Require API key for local Hermes
- Bundle vendor/nous-hermes in installer
- Expose passwords/cookies/tokens
- Show fake Hermes state when disconnected
- Claim build succeeded unless actually succeeded (check file sizes >1MB, MZ header)

---

## MASTER PROMPT END

---

## QUICK PROMPT (for ChatGPT/Claude quick integration)

> Integrate Hermes Design Studio (bkslongliveTHEGIGA/open-design34) with Nous Hermes Agent (NousResearch/hermes-agent). Fetch real Hermes source via `git submodule update --init vendor/nous-hermes`. Inspect `hermes_constants.py:get_hermes_home()`, `tui_gateway/server.py` JSON-RPC, `apps/desktop/` Electron, `gateway/run.py` API server on 8642. Fix `apps/desktop/src/main/hermes/detection.ts` to use real HERMES_HOME (%APPDATA%/hermes, ~/.hermes), PATH lookup, and endpoint http://127.0.0.1:8642/health (not 18789). Implement bridge at `apps/desktop/src/main/hermes/bridge.ts` with states NOT_INSTALLED, INSTALLED_NOT_RUNNING, RUNNING, CONNECTED, CONNECTION_LOST, RECONNECTING, auto-reconnect 5s, context sync (hermesProjectId, workspaceId, conversationId, modelId, themeId, etc.), actions designStudio.open/close/create/edit/generate/preview/export/sendToCode, events design.created/updated/variant.created/preview.ready/agent.progress/completed/failed, artifacts first-class, theme #0000F2, deep links hermes://design-studio/..., security no secrets to renderer. Validate installer does NOT contain vendor/nous-hermes, produces 100-500MB real Electron exe (v1.0.19 already does 438MB Setup + 223MB Portable). Test: hermes gateway start --api-server-enabled, curl 8642/health, launch Design Studio, should auto-connect, sync project/model/theme, support “Create homepage” from Hermes Chat, remain usable standalone, reconnect without restart.

---

## Integration Checklist for Developer

- [ ] `git submodule update --init --depth 1 vendor/nous-hermes` – inspect real source
- [ ] Read `hermes_constants.py`, `tui_gateway/server.py`, `apps/desktop/` in hermes-agent
- [ ] Fix detection.ts: HERMES_HOME, Windows paths, PATH, endpoint 8642 + tui_gateway
- [ ] Implement bridge.ts with 6 states + auto-reconnect
- [ ] Implement context.ts with adaptHermesContextFromUpstream
- [ ] Implement events.ts + forwarder
- [ ] Implement actions.ts registry
- [ ] Implement deeplink.ts validation + protocol registration
- [ ] Daemon endpoints: /api/hermes/actions, /api/hermes/events (SSE), /api/hermes/artifacts, /api/hermes/send-to-code
- [ ] Web: HermesProvider.tsx + HermesFloatingControls.tsx
- [ ] Branding: Hermes Design Studio everywhere, #0000F2
- [ ] Security: no secrets to renderer
- [ ] Installer: no vendor bundled, real exe >1MB, MZ header
- [ ] Release workflow: TrimStart('v'), PRODUCT_NAME, search RUNNER_TEMP
- [ ] Test: connected, standalone, reconnection, sendToCode
- [ ] Docs: docs/hermes-design-studio.md

---

## Current Implementation Files (already exist, need wiring to real Hermes)

```
apps/desktop/src/main/hermes/
├── types.ts      – Core types, brand #0000F2, actions, events
├── detection.ts  – Discovery (needs fix to 8642 + real paths)
├── bridge.ts     – Singleton bridge (needs real endpoint wiring)
├── context.ts    – Context store + project/model/theme sync
├── events.ts     – Event bus + forwarder
├── actions.ts    – Action registry
├── deeplink.ts   – hermes:// validation
└── index.ts      – Public API

apps/daemon/src/
└── integrations/hermes/ – Daemon bridge (check exists)

apps/web/src/hermes/
├── HermesProvider.tsx
└── HermesFloatingControls.tsx

tools/pack/src/win/
├── constants.ts  – PRODUCT_NAME = "Hermes Design Studio"
├── payload.ts    – Fixed to use PRODUCT_NAME (was Open Design.exe)
└── builder.ts    – Uses PRODUCT_NAME

.github/workflows/hermes-release.yml – Builds real Electron 438MB + 223MB (v1.0.19 verified)

scripts/validate-hermes-package.mjs – Fails if vendor/nous-hermes in bundle
```

---

## Real Hermes Agent Quick Reference

**Install:**
```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh
hermes --version
hermes setup
```

**HERMES_HOME:**
- Linux/macOS: `~/.hermes`
- Windows: `%APPDATA%\hermes` or `%LOCALAPPDATA%\hermes`
- Env var: `HERMES_HOME`
- Contains: `config.yaml`, `state.db`, `memories/`, `skills/`, `SOUL.md`

**Gateway:**
```bash
hermes gateway start
hermes gateway start --api-server-enabled true --api-server-host 0.0.0.0 --api-server-port 8642
curl http://127.0.0.1:8642/health
# Dashboard
# http://127.0.0.1:9119 when HERMES_DASHBOARD=1
```

**TUI Gateway (JSON-RPC for Desktop):**
- `tui_gateway/server.py` – JSON-RPC over stdio
- Methods in `methods_*.py`
- Desktop uses `apps/shared` JSON-RPC client

**Desktop:**
- `apps/desktop/` Electron in hermes-agent repo – reference for how Desktop talks to tui_gateway

**Profile Isolation:**
- `hermes -p <name>` – separate HERMES_HOME, config, memory, sessions
- Each profile has own gateway PID

---

## Expected Final Behavior

**When Hermes installed + running:**
- Design Studio auto-detects via HERMES_HOME + 8642/health
- Shows CONNECTED, syncs project/model/theme/artifacts
- Hermes Chat “Create homepage” → Design Studio creates, shows progress, preview, artifact
- Shared artifacts visible in both
- sendToCode works

**When Hermes not installed:**
- Shows NOT_INSTALLED, Standalone mode, fully functional (create/edit/generate/preview/export)

**When Hermes installed but not running:**
- Shows INSTALLED_NOT_RUNNING, offers to start, auto-reconnects every 5s

**When connection lost:**
- Shows CONNECTION_LOST, continues working, reconnects automatically, resyncs

**Installer:**
- 438MB Setup + 223MB Portable, valid PE MZ header, creates desktop shortcut, auto-launch, does NOT bundle Hermes or vendor/nous-hermes

---

*This prompt was generated for Hermes Design Studio v1.0.19 which already has working real Electron installer. The remaining task is wiring the bridge to real Nous Hermes Agent endpoints (8642 + tui_gateway) instead of placeholder 18789.*
