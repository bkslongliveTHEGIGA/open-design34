# SEAMLESS HERMES – ZERO-CLICK AUTO-CONNECT

## FOR AI AGENT – COPY THIS

You are making Hermes Design Studio auto-connect to Nous Hermes Agent with ZERO user config.

REAL HERMES:
- HERMES_HOME: ~/.hermes or %APPDATA%\hermes, contains config.yaml, state.db, SOUL.md
- Executable: hermes / hermes.exe on PATH
- Gateway: hermes gateway start --api-server-enabled true, health http://127.0.0.1:8642/health
- TUI Gateway: tui_gateway/server.py JSON-RPC, apps/shared client
- Desktop: apps/desktop/ Electron reference

SEAMLESS FLOW (no button):
On app start in background:
1. resolveHermesHome() -> HERMES_HOME env, %APPDATA%\hermes, ~/.hermes
2. findHermesExecutable() -> which hermes
3. checkHermesHomeValid() -> config.yaml/state.db/SOUL.md
4. If not found -> NOT_INSTALLED -> show ⚪ Standalone, no error, fully usable
5. If found but no endpoint -> INSTALLED_NOT_RUNNING -> try auto-start execFile(hermes, ["gateway","start","--api-server-enabled","true"]) silently, scheduleReconnect() every 5s
6. If endpoint 8642/health reachable -> RUNNING -> connect() immediately -> fetch /api/hermes/context -> CONNECTED, sync theme/model/project
7. UI: small dot 🟢 Connected / 🟡 Click to start / ⚪ Standalone, no modal, no primary Connect button
8. Auto-reconnect: if CONNECTION_LOST, keep usable, retry every 5s, resync on reconnect, max 50 attempts
9. Daemon: POST /api/hermes/actions always listening localhost, GET /api/hermes/events SSE, GET /api/hermes/status
10. Web: HermesProvider polls + SSE, floating controls for "Creating homepage..."

Code fix detection.ts to use 8642 not 18789, bridge.ts start() auto-connects + auto-starts gateway, scheduleReconnect even when NOT_INSTALLED to watch for later install.

TEST:
- No Hermes -> ⚪ Standalone <2s, usable
- Install Hermes, don't start gateway, launch Studio -> auto-detect INSTALLED_NOT_RUNNING, auto-start, 🟢 within 5s
- Hermes TUI "Create homepage for PartForge" -> Studio receives action via POST /api/hermes/actions, shows floating card
- Kill gateway -> Reconnecting... but usable
- Start gateway -> auto-reconnects

DO NOT: blocking modal, require API key for local, bundle vendor, show fake state.

END
