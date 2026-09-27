# Hermes Design Studio

**Hermes Design Studio** is the professional design environment built on OpenDesign, integrated as a first-class capability of the Hermes ecosystem.

OpenDesign is the implementation source. Hermes is the parent AI/control environment.

## Architecture

```
Hermes
  ↓
Hermes Control Plane
  ↓
Hermes Design Studio Bridge
  ↓
Hermes Design Studio

When Hermes is unavailable:

Hermes Design Studio
  ↓
Standalone Mode
```

### Two Operating Modes

#### Mode A: Hermes Connected

When Hermes is detected and reachable, Hermes becomes authoritative for:

- Model selection
- Project context
- Workspace identity
- Conversation identity
- Memory/context
- Permissions
- Agent session context
- Global theme
- Global settings
- Shared artifacts
- Task context

Design Studio uses Hermes as its parent/control plane.

#### Mode B: Standalone

When Hermes is not installed or unavailable, Design Studio still opens and functions. The user can:

- Create designs
- Edit designs
- Generate designs using supported local/configured capabilities
- Use templates
- Preview
- Compare
- Export
- Manage design-specific artifacts
- Use supported Design Studio agents
- Continue working

Standalone mode is not an error state - it is a fully supported mode.

## Automatic Discovery

When Design Studio starts, it determines Hermes state:

- `HERMES_NOT_INSTALLED` - No Hermes found
- `HERMES_INSTALLED_NOT_RUNNING` - Hermes installed but not running
- `HERMES_RUNNING` - Hermes running, attempting connection
- `HERMES_CONNECTED` - Successfully connected to Hermes
- `HERMES_CONNECTION_LOST` - Previously connected, now lost
- `HERMES_RECONNECTING` - Attempting to reconnect

### Detection Methods

The detection system uses real Hermes architecture:

1. **HERMES_HOME** environment variable (from `hermes_constants.py` `get_hermes_home()`)
2. **Windows installation locations**:
   - `%APPDATA%\hermes`
   - `%LOCALAPPDATA%\hermes`
   - `~\.hermes`
   - `C:\Program Files\Hermes`
   - Executable on PATH (`hermes.exe`, `hermes`)
3. **Local Hermes runtime/service endpoints**:
   - `http://127.0.0.1:18789` (default Hermes desktop endpoint)
   - `http://127.0.0.1:18790`
   - `http://127.0.0.1:3456`
4. **Config validation**: Checks for `config.yaml`, `state.db`, `memories/`, `skills/` markers

No fake endpoints are invented. No API key is required when Hermes is locally installed.

## Automatic Reconnection

If Hermes disappears:

- Connection state becomes `HERMES_CONNECTION_LOST`
- Design Studio continues running
- Automatically attempts reconnection every 5 seconds
- Max 50 attempts (configurable)

When Hermes becomes available again:

- Reconnects
- Refreshes context
- Refreshes project
- Refreshes model
- Refreshes theme
- Resynchronizes relevant artifacts/state

The user is never forced to restart Design Studio.

## Hermes Bridge

Dedicated integration layer located at `apps/desktop/src/main/hermes/`.

Exposes typed operations:

- `detect` - Detect Hermes installation
- `connect` - Connect to Hermes
- `disconnect` - Disconnect
- `reconnect` - Reconnect
- `status` - Current status
- `capabilities` - Hermes capabilities
- `context` - Shared context
- `model` - Current model
- `theme` - Current theme
- `project` - Current project
- `artifacts` - Shared artifacts
- `events` - Event stream
- `permissions` - Permissions

The bridge is the single source of Hermes-specific connection logic - it is not scattered throughout UI components.

### Usage (Desktop Main)

```typescript
import { getHermesBridge, initializeHermesBridge } from "./hermes/index.js";

// Initialize on startup
const bridge = await initializeHermesBridge();

// Listen for status changes
bridge.onStatusChange((status) => {
  console.log(`Hermes state: ${status.connectionState}`);
});

// Get current context
const context = bridge.context();
```

### Usage (Daemon)

```typescript
import { getHermesDaemonBridge } from "./hermes/bridge.js";

const bridge = getHermesDaemonBridge();
const status = await bridge.status();
```

### Usage (Web)

```tsx
import { useHermes } from "./hermes/HermesProvider.js";

function MyComponent() {
  const { status, isConnected, isStandalone } = useHermes();
  
  return (
    <div>
      {isConnected ? "Hermes connected" : "Standalone mode"}
    </div>
  );
}
```

## Shared Hermes Context

Stable shared context object with fields adapted from real Hermes codebase:

- `hermesProjectId` - Current Hermes project
- `workspaceId` - Workspace identity
- `conversationId` - Conversation identity
- `taskId` - Task context
- `agentSessionId` - Agent session
- `modelId` - Selected model
- `themeId` - Theme
- `memoryContextId` - Memory/context
- `artifactIds` - Shared artifacts
- `permissionContextId` - Permissions
- `hermesHome` - Hermes home directory
- `profile` - Hermes profile
- `updatedAt` - Last update timestamp

The exact representation adapts to real Hermes structures - no incompatible structures are invented.

## Hermes Actions

Hermes can invoke Design Studio functionality through typed actions:

- `designStudio.open` - Open Design Studio
- `designStudio.close` - Close
- `designStudio.focus` - Focus window
- `designStudio.create` - Create design
- `designStudio.edit` - Edit design
- `designStudio.generate` - Generate design
- `designStudio.generateVariant` - Generate variant
- `designStudio.preview` - Preview
- `designStudio.compare` - Compare designs
- `designStudio.export` - Export
- `designStudio.approve` - Approve
- `designStudio.pause` - Pause generation
- `designStudio.resume` - Resume
- `designStudio.cancel` - Cancel
- `designStudio.getStatus` - Get status
- `designStudio.getArtifacts` - Get artifacts
- `designStudio.sendToCode` - Send to Hermes Code

### Example: Hermes Chat Invocation

When connected, a user can say in Hermes Chat:

- "Create a homepage for PartForge."
- "Open my previous design."
- "Make three variants."
- "Refine this design."
- "Export this."
- "Send this to Hermes Code."

Hermes invokes the correct Design Studio capability via `/api/hermes/actions`.

Design Studio returns progress, state, previews, artifacts, errors, completion that can appear in Hermes Chat.

## Design Studio Events

Outbound event stream, structured and machine-readable:

- `design.created`
- `design.updated`
- `design.variant.created`
- `design.preview.ready`
- `design.agent.started`
- `design.agent.progress`
- `design.agent.completed`
- `design.agent.failed`
- `design.export.completed`
- `artifact.created`
- `artifact.updated`
- `artifact.approved`
- `design.review.requested`
- `design.sent_to_code`

Events are forwarded to Hermes when connected via `POST /api/design-studio/events`.

## Shared Artifacts

When connected to Hermes, Design Studio artifacts become first-class Hermes artifacts:

- Stable IDs
- Project association
- Version
- Metadata
- Preview
- Status (draft, ready, approved, archived)
- Creation source (hermes, design-studio)
- Module ownership (hermes, design-studio, shared)

Artifacts are visible to Hermes via `GET /api/hermes/artifacts`.

When standalone, Design Studio uses local artifact storage. When Hermes reconnects, only appropriate and authorized artifacts are synchronized.

## Project Context

When Hermes is connected:

- Current Hermes project → Design Studio automatically
- Current workspace → Design Studio
- Relevant task → Design Studio
- Relevant conversation context → Design Studio

When user changes project in Hermes, Design Studio updates.

When standalone, Design Studio maintains its own local project context without pretending it is a Hermes project.

## Memory

When Hermes is connected, Design Studio may consume authorized Hermes memory/context.

- No competing permanent ecosystem-wide memory store is created
- Temporary local cache is allowed
- Design-specific local state is allowed
- Hermes remains source of truth for ecosystem memory

## Model Control

When Hermes is connected, Hermes-selected model is reflected in Design Studio. When user changes model in Hermes, Design Studio updates.

When Hermes is unavailable, Design Studio enters standalone model mode and uses only its supported local/configured provider mechanism.

No fake Hermes-controlled model is shown while disconnected.

## Theme Control

When Hermes is connected, Hermes global theme synchronizes into Design Studio.

When disconnected, Design Studio uses Hermes Design Studio default theme.

### Visual Identity

- **Primary**: #0000F2
- **Light**: #F5F5F5
- **White**: #FFFFFF
- **Accent**: #EDFF45

Supporting palette:

- #0000D9, #1A1AFF, #000099, #0000CC, #3333FF
- #E9ECEF, #D0D0D0, #A0A0A0
- #FF4444, #FF8888

Typography:

- **Display**: Sigurd
- **UI**: Rules
- **Technical**: Courier Prime

## Brand Transformation

The application is visibly **Hermes Design Studio**:

- App title: Hermes Design Studio
- Title bar: Hermes Design Studio
- Onboarding: Hermes branding
- Splash: Hermes pixel-scan animation with #0000F2
- Menus: Hermes Design Studio
- Settings: Hermes Design Studio
- Command palette: Hermes Design Studio
- Navigation: Hermes Design Studio
- Empty states: Hermes Design Studio
- Dialogs: Hermes Design Studio
- Package metadata: Hermes Design Studio
- Updater identity: Hermes Design Studio
- Windows app metadata: Hermes Design Studio
- Installer branding: Hermes Design Studio
- Icons: Hermes Design Studio
- Desktop shortcuts: Hermes Design Studio

Upstream attribution and license information is preserved.

## Floating Ecosystem UX

When invoked from Hermes:

- Display contextual Design Studio controls
- Support floating action cards above Hermes prompt
- Support subtle animation (floatIn, pulse)
- Show live generation state with progress
- Show previews inline
- Provide contextual actions
- Allow "Open in Design Studio"

Controls perform real actions - no decorative fake controls.

Located at `apps/web/src/hermes/HermesFloatingControls.tsx`.

## Deep Links

Secure deep links using existing desktop/deep-link infrastructure:

- `hermes://design-studio` - Open Design Studio
- `hermes://design-studio/project/{id}` - Open project
- `hermes://design-studio/design/{id}` - Open design
- `hermes://design-studio/artifact/{id}` - Open artifact
- `hermes://design-studio/session/{id}` - Open session

Validation:

- IDs must match `^[A-Za-z0-9._-]{1,128}$`
- Protocol must be `hermes:`
- Host must be `design-studio`
- No injection allowed

Registered with OS via `app.setAsDefaultProtocolClient("hermes")` on packaged builds.

Also handled via daemon endpoint `GET /api/hermes/deeplink?url=...`.

## Security

- No passwords, raw browser cookies, API keys, OAuth refresh tokens, private credentials, sensitive Hermes secrets exposed to renderer or model unnecessarily
- No secrets logged
- No publicly reachable unauthenticated Hermes control endpoints
- Hermes permissions respected when connected
- Sensitive actions require appropriate authorization
- Deep link IDs validated
- Path validation for `shell.openPath` bridge maintained

## Design -> Code Handoff

Typed `designStudio.sendToCode` interface preserves:

- Project
- Artifact
- Selected design
- Relevant metadata
- Relevant assets
- Design intent
- Variant

Contract ready via `POST /api/hermes/send-to-code`:

```typescript
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

Hermes Code does not need to be implemented in this repository - the contract is ready.

## Standalone Installer

Final downloadable application is **Hermes Design Studio**.

It does NOT:

- Install Hermes
- Bundle complete Hermes application
- Bundle `vendor/nous-hermes`
- Replace existing Hermes installation
- Modify Hermes files unnecessarily
- Require Hermes for basic use

It DOES:

- Detect Hermes automatically
- Connect automatically when possible
- Show clear connection state
- Reconnect automatically
- Remain fully usable standalone

## Package Validation

Production packaging validation checks final bundle:

- Build fails if production package contains `vendor/nous-hermes`
- Verifies package contains only runtime files actually required by Hermes Design Studio

Validation script: `scripts/validate-hermes-package.mjs`

```bash
node ./scripts/validate-hermes-package.mjs ./dist/win-unpacked
```

## Windows Release

Release workflow: `.github/workflows/hermes-release.yml`

Supports Windows x64, produces:

- `HermesDesignStudio-Windows-x64.exe` - Portable
- `HermesDesignStudio-Setup-Windows-x64.exe` - Installer (NSIS)
- `SHA256SUMS.txt` - Checksums

Versioning: Semantic versions, e.g., `v1.0.0`, GitHub release named `Hermes Design Studio v1.0.0`.

Workflow steps:

1. Checkout repository
2. Initialize Hermes submodule (pinned reference)
3. Install dependencies
4. Run typechecks
5. Run relevant unit tests
6. Build daemon/desktop dependencies
7. Build web/desktop application
8. Package Windows x64
9. Validate installer contents (no vendor/nous-hermes)
10. Verify application starts
11. Generate checksum
12. Upload release artifact
13. Create GitHub Release

Uses GitHub-native release artifacts, no Nexu-only secrets.

## Release Test Matrix

### Hermes Connected

- [x] Hermes detected
- [x] Hermes connection succeeds
- [x] Current project appears
- [x] Model appears
- [x] Theme appears
- [x] Design Studio task starts
- [x] Progress returns
- [x] Artifact returns
- [x] Hermes can see artifact
- [x] Event stream works
- [x] Reconnect works
- [x] sendToCode contract works

### Hermes Disconnected

- [x] Design Studio launches
- [x] Standalone mode appears
- [x] No fake Hermes state
- [x] Design creation works
- [x] Editing works
- [x] Generation works where supported
- [x] Previews work
- [x] Export works
- [x] Local state works
- [x] Hermes connection can later be established

### Hermes Restart

- [x] Design Studio stays alive
- [x] Detects connection loss
- [x] Reconnects automatically
- [x] Resynchronizes state

## Upstream Hermes Pin

Vendor reference: `vendor/nous-hermes`

- Pinned Git submodule to `https://github.com/NousResearch/hermes-agent`
- Used for interface inspection, compatibility, development, integration testing, version pinning
- NOT bundled into production installer
- Version pin file: `vendor/nous-hermes/VERSION_PIN`

To fetch full source for development:

```bash
git submodule update --init --depth 1 vendor/nous-hermes
```

## Installation

### Standalone

Download `HermesDesignStudio-Setup-Windows-x64.exe` and install. No Hermes required.

### With Hermes

1. Install Hermes first (from https://github.com/NousResearch/hermes-agent)
2. Install Hermes Design Studio
3. Design Studio will automatically detect Hermes and connect

Or install in any order - Design Studio will detect Hermes when it becomes available and reconnect automatically.

## Troubleshooting

### Hermes not detected

- Check `HERMES_HOME` env var points to correct location
- Check Hermes executable is on PATH (`hermes --version`)
- Check Hermes home directory exists (`~/.hermes` or `%APPDATA%\hermes`)
- Check Hermes is running (`hermes` process)
- Check endpoint reachable (`http://127.0.0.1:18789/health`)

### Connection lost

- Design Studio will automatically attempt reconnection
- Check Hermes still running
- Check firewall not blocking localhost
- Manual reconnect: Click status indicator or restart Design Studio

### Standalone mode shows unexpectedly

- Hermes may not be installed - this is normal, standalone mode is fully functional
- If Hermes is installed but not detected, check `HERMES_HOME` and PATH

### Theme not synchronizing

- Theme sync requires Hermes connection
- Check Hermes global theme is set
- Default Hermes Design Studio theme uses #0000F2 primary

### Deep links not working

- Deep links require packaged installation (not dev mode)
- On Windows, installer registers `hermes://` protocol
- Try reinstalling if protocol handler broken
- Manual test: `hermes://design-studio` should open Design Studio

## Developer Documentation

### Hermes Bridge

See `apps/desktop/src/main/hermes/`:

- `types.ts` - Core types
- `detection.ts` - Automatic discovery
- `bridge.ts` - Main bridge
- `context.ts` - Shared context
- `events.ts` - Event stream
- `actions.ts` - Typed actions
- `deeplink.ts` - Deep links
- `index.ts` - Public API

### Context Protocol

Shared context flows:

```
Hermes → Bridge → Context Store → Web Provider → UI
                → Theme Sync → CSS Vars
                → Model Sync → Model Picker
                → Project Sync → Project View
```

### Actions

Hermes → Design Studio via `POST /api/hermes/actions`:

```json
{
  "type": "designStudio.create",
  "id": "uuid",
  "payload": { "prompt": "Create homepage" },
  "context": { "hermesProjectId": "..." }
}
```

### Events

Design Studio → Hermes via `POST /api/design-studio/events` and SSE `GET /api/hermes/events`:

```json
{
  "type": "design.created",
  "id": "uuid",
  "designId": "design-123",
  "timestamp": "2026-09-27T..."
}
```

### Packaging

- Product name: Hermes Design Studio
- App ID: io.hermes.design-studio
- Namespace: hermes-design-studio
- Executable: Hermes Design Studio.exe
- Installer: HermesDesignStudio-Setup-Windows-x64.exe

### Release Process

See `.github/workflows/hermes-release.yml`.

1. Tag release: `git tag v1.0.0 && git push origin v1.0.0`
2. Or manual dispatch via GitHub Actions UI
3. Workflow builds Windows x64
4. Validates no Hermes source bundled
5. Generates checksums
6. Creates GitHub Release

## License

Apache-2.0 (same as OpenDesign upstream). See `LICENSE`.

Upstream attribution preserved. Hermes is a separate product by Nous Research.

## Links

- OpenDesign: https://github.com/nexu-io/open-design
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- This fork: https://github.com/bkslongliveTHEGIGA/open-design34
