# Hermes Design Studio

**Hermes Design Studio** is a dedicated design application that runs as a
first-class module of [Nous Hermes](https://github.com/NousResearch/hermes-agent).

The relationship is one-directional and deliberate:

> **Hermes is the parent AI and control plane. Design Studio is a design
> capability Hermes can invoke.**

Design Studio does not embed Hermes, does not ship a second AI runtime, and does
not duplicate Hermes' global systems. It contributes design — and consumes
everything global (models, identity, permissions, memory, theme, projects) from
Hermes when Hermes is present.

```
                HERMES
                   |
            Hermes Control Plane
                   |
        Hermes Design Studio Bridge
                   |
          Hermes Design Studio
                   |
          +--------+--------+
          |                 |
    Connected Mode     Standalone Mode
          |                 |
   Hermes projects      Local projects
   Hermes models       Local/configured model
   Hermes memory       Design-local state
   Hermes events       Local state
   Hermes artifacts    Local artifacts
```

Related documents:

- [`hermes-integration.md`](./hermes-integration.md) — architecture, layer map,
  transports, actions, events, permissions, packaging internals, tests.
- [`hermes-installation.md`](./hermes-installation.md) — installing Hermes and
  Design Studio, per-state behaviour, development setup.

---

## Two operating modes

Both are valid. Neither is an error state.

### Connected mode

When Hermes is detected and reachable, Hermes is authoritative for: model
selection and provider routing, project and workspace identity, conversation
identity, memory and context, permissions, agent session context, global theme,
global settings, shared artifacts, and task context.

Design Studio reflects those rather than reimplementing them. Where it needs a
global capability it holds a **projection** — read-only, invalidated on resync —
never a parallel copy.

### Standalone mode

When Hermes is absent or unreachable, Design Studio still opens and works:
create, edit, generate (through supported local/configured capabilities),
templates, preview, compare, export, design-specific artifacts, and Design
Studio agents.

Standalone mode is stated plainly. It does **not** fake a connection, does not
stub a model, and does not hide the difference:

| State shown | Meaning |
|---|---|
| **Hermes connected** | Attached; Hermes is authoritative. |
| **Hermes unavailable** | An install was found but is not reachable right now. |
| **Standalone mode** | No Hermes install; Design Studio is running on its own. |

---

## Connection state machine

Implemented in `apps/desktop/src/main/hermes/hermes-bridge.ts` as
`HermesBridgeState`. Every transition carries a machine-readable reason.

| Implemented state | Conceptual equivalent |
|---|---|
| `disconnected` | initial, before discovery |
| `discovering` | probing for an install |
| `not-installed` | HERMES_NOT_INSTALLED |
| `installed-idle` | HERMES_INSTALLED_NOT_RUNNING |
| `connecting` | HERMES_RUNNING → attaching |
| `connected` | HERMES_CONNECTED |
| `reconnecting` | HERMES_CONNECTION_LOST / HERMES_RECONNECTING |

Design Studio keeps running through every state. Losing Hermes never terminates
it, and reconnecting never requires a restart.

---

## Automatic discovery

Ordered, matching upstream's own precedence. No location is invented, and a
directory only counts as an install when it carries upstream's markers
(`config.yaml`, `.env`, `state.db`).

1. `HERMES_HOME`
2. Windows install locations — `%LOCALAPPDATA%\hermes`,
   `%USERPROFILE%\AppData\Local\hermes`, `%USERPROFILE%\.hermes`,
   `%ProgramFiles%\Hermes`
3. Platform default root
4. `hermes` on `PATH`
5. A running local endpoint, via the spawn ledger

The spawn ledger is **discovery only** — read, never written, and never treated
as proof of liveness.

---

## Reconnection and resync

If Hermes disappears, the bridge moves to `reconnecting` and keeps retrying in
the background. When it returns:

1. reconnect;
2. refresh context, project, model and theme;
3. resynchronize relevant artifacts and state;
4. drain any events buffered while the link was down.

**Restart vs. upgrade** is distinguished by upstream's own fields — `identify.pid`
changes on restart, `install_id` on upgrade. A restart re-attaches; an upgrade
re-reads the model and theme projections first, because an upgrade may have
changed them.

Events that occurred while disconnected are buffered with bounded overflow and
delivered afterwards, so a generation that completed offline still reports.

---

## Synchronisation

**Project context.** The current Hermes project, workspace, relevant task and
conversation flow in automatically. Changing project in Hermes updates Design
Studio. Standalone, Design Studio keeps its own local project context without
claiming it is a Hermes project.

**Model.** Hermes' selected model is reflected in Design Studio; changing it in
Hermes propagates. Model *selection* stays Hermes' — `POST /api/model/set` is
deliberately not wrapped, so there is exactly one place a model is chosen.
Disconnected, Design Studio enters standalone model mode using only its
supported local/configured mechanism, and does not pretend a Hermes-controlled
model exists.

**Theme.** Hermes' global theme synchronises in through
`hermes-theme-adapter.ts`, mapping upstream's `DashboardTheme` shape. Note that
upstream's `foreground` is invisible by default (`#ffffff` at alpha 0), so it is
not mapped to an accent colour. Disconnected, the Hermes Design Studio default
theme applies.

**Artifacts.** When connected, Design Studio artifacts become first-class Hermes
artifacts: stable IDs, project and conversation association, version, metadata,
preview, status, creation source, module ownership, and export info. Hermes can
discover them and pass them back in. Standalone, local artifact storage is used;
on reconnect only what is appropriate and authorized is synchronized.

**Memory.** Hermes memory is consumed through the official integration path when
authorized. There is no competing permanent memory store — temporary local
caching and design-specific local state only.

---

## Security

- No password, token or credential is ever sent to a model.
- No raw cookie or Hermes credential reaches the renderer.
- Auth tokens are never logged.
- No unauthenticated or publicly reachable control endpoint is created.
- Loopback only; the publish URL is validated before dialing.
- Status responses are redacted before crossing into the renderer — upstream
  only includes `hermes_home`, `config_path`, `env_path`, `gateway_pid`,
  `gateway_health_url` and `gateways` when `auth_required` is false, and they are
  stripped regardless.

Hermes' approval model (`manual` / `smart` / `off`, profile-scoped, re-read on
every check, possibly *managed*) is authoritative. Permission decisions are
**fail-closed**. Read-only actions are gated separately from actions that invoke
agents, touch the filesystem, or leave the machine. Nothing bypasses the model
silently, and minimum permissions apply per action.

All of the above are asserted by
`apps/desktop/tests/main/hermes/hermes-security.test.ts`, not merely documented.

---

## Design → Code handoff

`designStudio.sendToCode` is a typed contract that preserves project, artifact,
selected design and variant, relevant metadata and assets, and design intent. It
reuses the existing `ArtifactManifest.handoffKind` from
`packages/contracts/src/api/artifacts.ts` rather than inventing a new shape.

Hermes Code is not implemented in this repository; the contract is ready for it.
No manual download/upload is involved.

---

## Installation

See [`hermes-installation.md`](./hermes-installation.md) for the full procedure.
In brief: install Hermes through upstream's own installer, then install Design
Studio from `HermesDesignStudio-Setup-Windows-x64.exe` (or the portable
`HermesDesignStudio-Windows-x64.exe`). Verify with `sha256sum -c SHA256SUMS.txt`.

The installer contains Design Studio only. It does not install, bundle, replace
or modify Hermes, does not contain `vendor/nous-hermes`, and does not register
the `hermes://` protocol.

---

## Troubleshooting

**Design Studio says "Standalone mode" but Hermes is installed.** Set
`HERMES_HOME` to the install root explicitly; it takes precedence over every
other probe. The directory must contain `config.yaml`, `.env` or `state.db` to
count.

**Hermes is installed but shows "Hermes unavailable".** The install was found but
no endpoint answered. Start Hermes and Design Studio re-attaches on its own — no
restart needed.

**Custom install location not found.** Only the documented locations are probed;
anything else needs `HERMES_HOME`.

**Model or theme looks stale after a Hermes upgrade.** Upgrades are detected via
`install_id` and trigger a re-read. If it persists, reconnecting forces a full
resync.

**Floating controls do nothing.** They are wired to real actions and report
availability through `manifest()`. An action shown unavailable is gated by
Hermes' approval mode, not broken.

**Build fails with a vendored-Hermes exclusion error.** That is the packaging
gate working. `vendor/nous-hermes` must not be in a production bundle — see
[`hermes-integration.md` §8](./hermes-integration.md#8-packaging-and-the-vendored-source-exclusion-gate).

---

## Developer reference

| Topic | Where |
|---|---|
| Bridge, layer map, ownership | [`hermes-integration.md`](./hermes-integration.md) §2 |
| Upstream pin and cited surface | `apps/desktop/src/main/hermes/upstream-pin.ts`; `scripts/hermes/verify-upstream-pin.mjs` |
| Context protocol | `hermes-context.ts`; §7 of the integration doc |
| Actions | `hermes-actions.ts` — 21 actions across 5 risk tiers |
| Events | `hermes-events.ts` — 14 event types over upstream's event bus |
| Deep links | `hermes-deeplink.ts` — `hermes-design-studio://`, plus parsing `hermes://design-studio/...` |
| Brand single source | `hermes-brand.ts`; CSS generated into `apps/web/src/styles/hermes-brand.css` |
| Packaging + exclusion gate | `tools/pack/src/win/release-artifacts.ts`, wired into `tools/pack/src/win/builder.ts` |
| Release process | `.github/workflows/hermes-design-studio-release.yml` |

### Brand and fonts

The stylesheet is **generated** — edit `hermes-brand.ts` and run
`pnpm exec tsx scripts/hermes/generate-brand-css.ts`. CI fails on drift with
`--check`.

**Rules** is vendored from the pinned submodule into
`apps/web/public/fonts/hermes/` as four real faces; because Rules ships as two
distinct cuts, the `@font-face` rules declare `font-stretch`.

**Sigurd** and **Courier Prime** are *not* available to this repository and are
not vendored — `assetVendored: false` records that honestly, the stacks name them
first, and there is no silent lookalike substitution. Dropping real binaries into
`apps/web/public/fonts/hermes/` is all that is needed to promote them.

### Naming policy

Only the **display** identity is "Hermes Design Studio". Package names
(`@open-design/*`), the `io.open-design.desktop` appId, `OD_*` environment
variables, the `open-design` namespace and the Windows Uninstall registry key are
internal identifiers left unchanged on purpose: renaming them would orphan
installed users' registry keys, userData paths, code-signing identity and updater
feeds. That is a functional regression, not a rebrand.

---

## Attribution

Hermes is © Nous Research, vendored here as a pinned submodule for development
and interface verification. The Rules typefaces come from that same upstream
source. Nothing in this repository claims ownership of upstream code, and no
production artifact redistributes Hermes.
