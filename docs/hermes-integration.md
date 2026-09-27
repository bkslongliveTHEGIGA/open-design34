# Hermes Design Studio — integration architecture

This repository is **Hermes Design Studio**: a dedicated design application that
runs as a first-class module of [Nous Hermes](https://github.com/NousResearch/hermes-agent).

The governing rule is one-directional:

> **Hermes is the parent AI and control plane. Design Studio is a design
> capability that Hermes can invoke.**

Design Studio does not embed Hermes, does not ship a second AI runtime, and does
not duplicate Hermes' global systems. It contributes one thing — design — and
consumes everything global (models, identity, permissions, memory, theme,
projects) from Hermes when Hermes is present.

For installing or upgrading Hermes itself, see
[`hermes-installation.md`](./hermes-installation.md).

---

## 1. Upstream pin

The bridge is written against real upstream source, not a guessed API. That
source is vendored as a **pinned git submodule**:

| | |
|---|---|
| Path | `vendor/nous-hermes` |
| Remote | `https://github.com/NousResearch/hermes-agent.git` |
| Pinned commit | `6f7a7991bb069db07ae74a479823ce8310f8c7e0` |
| Declared in | `apps/desktop/src/main/hermes/upstream-pin.ts` |

`upstream-pin.ts` also records `HERMES_UPSTREAM_SURFACE`: the specific upstream
modules and symbols the integration reads, plus
`HERMES_CONTROL_PROTOCOL_VERSION`. `scripts/hermes/verify-upstream-pin.mjs`
re-checks all of them against the checked-out submodule, so bumping the pin
without re-reading the cited symbols fails CI:

```
node scripts/hermes/verify-upstream-pin.mjs --require-submodule
```

The submodule is a **development dependency only**. It is excluded from
production bundles and is never checked out on the Windows packaging job — see
[§8](#8-packaging-and-the-vendored-source-exclusion-gate).

---

## 2. Layer map

```
Hermes (parent app)
  └─ Hermes Core  ·  model routing · identity · permissions · memory · projects
       └─ Capability Registry
            └─ Hermes Design Studio          ← this repository
                 ├─ Web UI      (apps/web)
                 ├─ Daemon      (apps/daemon)
                 └─ Desktop     (apps/desktop, Electron)
                      └─ Sidecar / IPC  (packages/sidecar, packages/sidecar-proto)
                           └─ Design Engine
                                └─ Projects · Artifacts · Skills
```

### Integration layer

`apps/desktop/src/main/hermes/` holds the whole bridge. It is deliberately
**Electron-free and dependency-injected**: every filesystem, clock, socket and
PATH probe arrives through an injected port, and a test asserts no module in
that directory imports `electron`. That is what makes the 257-test suite
runnable on any platform and without an Electron binary.

| Module | Responsibility |
|---|---|
| `upstream-pin.ts` | Pinned commit, cited upstream surface, control-protocol version. |
| `hermes-paths.ts` | `HERMES_HOME` resolution, machine root, gateway socket paths. |
| `hermes-discovery.ts` | Ordered discovery, spawn-ledger parsing, spawn-or-attach. |
| `hermes-control-protocol.ts` | Gateway control-socket framing and limits. |
| `hermes-control-client.ts` | Control-socket transport with retry policy. |
| `hermes-context.ts` | Typed shared context, redaction. |
| `hermes-permissions.ts` | Risk tiers, approval modes, fail-closed decisions. |
| `hermes-actions.ts` | Hermes → Design Studio action registry and dispatch. |
| `hermes-events.ts` | Design Studio → Hermes event catalogue and publish path. |
| `hermes-model-adapter.ts` | Read-only projection of Hermes model state. |
| `hermes-theme-adapter.ts` | `DashboardTheme` → Design Studio tokens. |
| `hermes-runtime-adapter.ts` | Lifecycle, restart/upgrade detection, resync. |
| `hermes-artifact-adapter.ts` | Artifacts as first-class Hermes artifacts. |
| `hermes-bridge.ts` | Composition root; owns connection state. |
| `hermes-deeplink.ts` | Deep-link parse/build on existing OD34 infrastructure. |
| `hermes-controls.ts` | Floating controls → action bindings. |
| `hermes-brand.ts` | Palette, fonts, wordmarks, contrast. Single source for the CSS. |

The **only** Electron-coupled Hermes file is
`apps/desktop/src/main/hermes-desktop.ts`, which sits outside that directory on
purpose. It supplies real `fs`/PATH adapters, registers the protocol handler and
wires the `HERMES_IPC` channels.

### Ownership

**Hermes owns** (Design Studio never reimplements): the AI runtime; model
selection and provider routing including OpenRouter; identity and auth;
conversations; projects, workspaces and memory; global permissions; agent
sessions; mission/task state; global theme; global settings; shared artifact
identity; cross-module orchestration.

**Design Studio owns**: the canvas; design documents; visual editing;
generation; variants; previews; exports; design-specific templates, skills,
agents and interaction state.

There is no parallel global system. Where a capability is Hermes', Design Studio
holds at most a *projection* of it — read-only, invalidated on resync.

---

## 3. Discovery

Ordered, and matching upstream's own precedence. No location is invented.

1. **`HERMES_HOME`** — explicit environment override, wins outright.
2. **Common Windows install locations** — exactly the four
   `windowsHermesHomeCandidates()` probes, de-duplicated in order:
   `%LOCALAPPDATA%\hermes`, `%USERPROFILE%\AppData\Local\hermes`,
   `%USERPROFILE%\.hermes`, `%ProgramFiles%\Hermes`.
3. **Platform default** — upstream's `get_default_hermes_root()` rules.
4. **`hermes` on `PATH`** — resolved executable, then its root.
5. **Existing local endpoint** — the spawn ledger.

A candidate only counts as an install when it carries upstream's own markers
(`config.yaml`, `.env`, `state.db`).

The spawn ledger at `<machine_root>/spawn-ledger.json` is **discovery only**.
Design Studio reads it to find an attachable backend (purposes `dashboard` and
`serve`; bind hosts `''`, `0.0.0.0`, `127.0.0.1`, `::`, `::1`, `localhost` all
dial back on loopback). It never writes to it and never treats a ledger entry as
proof of liveness — that requires a live probe.

States handled: found and running, found but offline, not installed, custom
location, temporarily unavailable, restarted, upgraded. Reconnect is automatic,
and a resync follows every reconnect.

**Restart vs. upgrade** is distinguished by upstream's own fields:
`identify.pid` changes on restart, `install_id` changes on upgrade. They drive
different recovery — a restart re-attaches, an upgrade re-reads the model and
theme projections before resuming.

---

## 4. Communication

Two real upstream transports. No new one was invented, and Hermes needs no
change to support either.

**Gateway control socket** — protocol version 1, one JSON line per connection,
64 KB request / 512 KB response / 2 s timeout, verbs `identify` and `status`.
POSIX uses `gateway.sock` with a `gateway.sock.path` pointer (respecting the
100-byte `sun_path` margin via a `hermes-gw-<hash16>.sock` temp); Windows uses
`\\.\pipe\hermes-gateway-<sha256(normcase(home))[:16]>`. **The filesystem ACL is
the authentication boundary**, so nothing is added on top and nothing is
weakened.

**HTTP / WebSocket** — authentication is upstream's `X-Hermes-Session-Token`
header, or `?token=` for WebSockets; the token is inlined at `GET /` as
`window.__HERMES_SESSION_TOKEN__` on ungated loopback, with the OAuth
alternative `?ticket=` from `POST /api/auth/ws-ticket`.

Events ride `WS /api/events?channel=design-studio`, the same event bus the
React sidebar's tool-call feed already uses. Upstream validates the channel
against `^[A-Za-z0-9._-]{1,128}$` — `design-studio` satisfies it. Its close
codes are handled explicitly: **4403** chat disabled (drain and stop), **4401**
bad auth, **4400** invalid channel.

The retry policy never resends a request whose body was already written after
`ECONNRESET`/`EPIPE`, because that would duplicate a side-effecting call.

---

## 5. Actions (Hermes → Design Studio)

Namespace `designStudio`, each with a risk tier that gates it:

| Risk | Actions |
|---|---|
| `read` | `open`, `close`, `focus`, `preview`, `compare`, `getStatus`, `getArtifacts`, `listSkills` |
| `write` | `create`, `edit`, `approve`, `pause`, `resume`, `cancel`, `applyDesignSystem` |
| `agent` | `generate`, `generateVariant`, `critique` |
| `filesystem` | `export` |
| `external` | `sendToCode`, `handoff` |

The last four are extras backed by capabilities this repository already ships.
Actions are **structured capability calls, not synthesised UI clicks** — each
dispatches through a typed registry that records an audit entry and can report
unavailability (`manifest()` exposes `{ name, action, risk, available }`).

## 6. Events (Design Studio → Hermes)

`design.created`, `design.updated`, `design.variant.created`,
`design.preview.ready`, `design.agent.started`, `design.agent.progress`,
`design.agent.completed`, `design.agent.failed`, `design.export.completed`,
`design.review.requested`, `design.sent_to_code`, `artifact.created`,
`artifact.updated`, `artifact.approved`.

Events are buffered with bounded overflow and drained on reconnect, so a
generation that completes while the link is down is still delivered.

---

## 7. Permissions and security

Upstream's approval model is authoritative: `VALID_APPROVAL_MODES = ("manual",
"smart", "off")`, profile-scoped at `approvals.mode`, re-read on every check,
and possibly *managed* (immutable). `decideHermesPermission` is **fail-closed** —
an unreadable or unrecognised mode denies.

Read-only actions are treated differently from actions that execute code, touch
files, export content, modify projects, invoke agents, read private memory or
talk externally. Nothing bypasses the Hermes permission model, and minimum
permissions are applied per action.

Hard rules the code enforces (asserted in `hermes-security.test.ts`):

- No password, token or credential is ever sent to a model.
- No raw cookie or Hermes credential reaches the renderer.
- Auth tokens are never logged.
- No unauthenticated or publicly-exposed control endpoint is created.
- Loopback only: the publish URL is validated before dialing.
- No module under `src/main/hermes/` imports `nous-hermes`, writes to the
  filesystem, or `console.log`s a secret.
- The audit hook cannot throw into the action it is auditing.

Status responses are redacted before they cross into the renderer. Upstream only
includes `hermes_home`, `config_path`, `env_path`, `gateway_pid`,
`gateway_health_url` and `gateways` when `auth_required` is false; they are
stripped regardless.

**Memory.** Design Studio keeps no competing permanent memory. Hermes memory is
reached through the official integration path when authorized; local caching is
temporary only.

---

## 8. Packaging and the vendored-source exclusion gate

The installer contains Design Studio and nothing else. It does not install or
modify Hermes.

The gate has two halves:

- **Preventive** — `tools/pack/src/win/constants.ts` excludes `!**/vendor/nous-hermes`,
  `!**/vendor/nous-hermes/**` and `!**/vendor/**/hermes-agent/**` from
  `ELECTRON_BUILDER_FILE_PATTERNS`.
- **Detective** — `tools/pack/src/win/release-artifacts.ts` walks the built
  package and throws on any vendored path. It is wired into
  `tools/pack/src/win/builder.ts` alongside the existing sidecar-runtime
  assertion, so it runs on cache hits as well as fresh builds — a poisoned cache
  cannot smuggle the submodule through.

`scripts/hermes/prepare-release-artifacts.ts` re-asserts the same thing over the
finished artifacts immediately before publication, then renames and checksums.
It exits non-zero on any violation, so a violating build publishes nothing.

Published names, derived from the internal `${PRODUCT_NAME}-${namespace}-…`
scheme (which stays put because the blockmap and `latest.yml` updater feed
depend on it):

```
HermesDesignStudio-Windows-x64.exe
HermesDesignStudio-Setup-Windows-x64.exe
SHA256SUMS.txt          # GNU coreutils format; verify with `sha256sum -c`
```

Production builds run from `.github/workflows/hermes-design-studio-release.yml`
on `v*.*.*` tags: resolve tag → verify pin against the real submodule →
typecheck → tests → package on Windows → assert exclusion → rename + checksum →
GitHub Release → upload. The submodule is checked out on the Linux verify job
and deliberately **not** on the Windows packaging job.

---

## 9. Deep links

Built on the **existing** OpenDesign34 deep-link infrastructure
(`invite-deeplink-core.ts`, `deeplink-focus.ts`) rather than a parallel scheme.

Hermes claims `hermes://` at runtime via `app.setAsDefaultProtocolClient` and
re-asserts it on every start, so Design Studio registers
**`hermes-design-studio://`** and additionally *parses* the
`hermes://design-studio/...` form Hermes emits. Routes: `project/{id}`,
`design/{id}`, `artifact/{id}`, `session/{id}`. Identifiers containing traversal
are rejected. In development `planHermesProtocolClientRegistration` returns
`{ register: false, reason: "not-packaged" }` and never registers `hermes://`.

---

## 10. Standalone mode

Design Studio is fully usable without Hermes. When no install is found it says
so plainly — it does not fake a connection, does not stub a model, and does not
hide the difference. Supported standalone functionality stays available, the
user can connect later, and discovery re-runs so a Hermes install that appears
afterwards is picked up automatically.

---

## 11. Brand

Single source: `apps/desktop/src/main/hermes/hermes-brand.ts`. The stylesheet
`apps/web/src/styles/hermes-brand.css` is **generated** from it — regenerate with
`pnpm exec tsx scripts/hermes/generate-brand-css.ts`, and CI fails on drift with
`--check`.

Palette: primary `#0000F2`, light `#F5F5F5`, white `#FFFFFF`, accent `#EDFF45`,
plus the supporting ramp. The accent-on-primary pair used by the floating
controls is asserted to clear WCAG AA for normal text.

Fonts: **Rules** is vendored from the pinned submodule into
`apps/web/public/fonts/hermes/` as four real faces. Rules ships as two distinct
cuts, so its `@font-face` rules declare `font-stretch` (`compressed` /
`expanded`) — a compressed face used at normal width is visibly wrong.

**Sigurd** and **Courier Prime** are *not* available to this repository and are
not vendored. `assetVendored: false` records that honestly; the stacks name them
first and fall back to named faces, never a silent lookalike. Supplying real
binaries to `apps/web/public/fonts/hermes/` is all that is needed to promote
them.

---

## 12. Tests

`apps/desktop/tests/main/hermes/` — 8 files, 257 tests, all passing:

| File | Covers |
|---|---|
| `hermes-paths.test.ts` | Platform-aware paths, home hash, socket resolution. |
| `hermes-discovery.test.ts` | Ledger parsing and gating, spawn-or-attach, discovery order, Windows paths. |
| `hermes-bridge.test.ts` | Discovery states, model/theme/context sync, redaction, reconnect, upgrade vs. restart, generation counter, publish. |
| `hermes-permissions-actions.test.ts` | Approval modes, fail-closed, registry dispatch/audit/manifest, intent matching. |
| `hermes-events.test.ts` | Channel validity, catalogue, buffering/overflow/4403 drain, frame parsing, Chat-card eligibility, loopback guard. |
| `hermes-context-adapters.test.ts` | Context mapping/redaction/diff, model adapter, theme adapter, artifact descriptor, sendToCode handoff. |
| `hermes-deeplink-controls-brand.test.ts` | Both schemes, action links, traversal rejection, dev non-registration, control→action binding, palette/wordmark/contrast. |
| `hermes-security.test.ts` | Module boundary, token handling, credential redaction, loopback-only dialing, socket limits, logging discipline. |

`tools/pack/tests/release-artifacts.test.ts` — 24 tests covering artifact
naming, `SHA256SUMS` render/parse/verify, the exclusion gate and the packaged
tree walker (including a real-filesystem negative case).

Run them with:

```
cd apps/desktop && pnpm exec vitest run -c vitest.config.ts tests/main/hermes/
cd tools/pack   && pnpm exec vitest run tests/release-artifacts.test.ts
```
