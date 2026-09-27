# Hermes Design Studio — installation

Hermes Design Studio is a **module of Hermes**, not a replacement for it. This
page covers getting a working pair: Hermes itself, Design Studio alongside it,
and what to do in each of the states you can land in.

For how the two actually talk, see
[`hermes-integration.md`](./hermes-integration.md).

---

## What gets installed where

| | |
|---|---|
| **Hermes** | Installed by *you*, separately, via upstream's own installer. Design Studio never installs, updates or modifies it. |
| **Design Studio** | Installed from `HermesDesignStudio-Setup-Windows-x64.exe` (installer) or `HermesDesignStudio-Windows-x64.exe` (portable). |
| **Vendored Hermes source** | Never installed. `vendor/nous-hermes` is a development submodule, excluded from every production bundle and verified absent before publication. |

**No API keys, tokens, provider configuration, accounts or project files are
ever entered into Design Studio.** Identity, model selection and provider
routing (including OpenRouter) all stay with Hermes. If a screen asks you for a
key, that is Hermes' screen, reached through Hermes.

---

## 1. Install Hermes

Use upstream's supported path. On Windows:

```powershell
# See https://github.com/NousResearch/hermes-agent
.\install.ps1
```

Then confirm it runs:

```powershell
hermes --version
```

Design Studio requires nothing beyond a working upstream install. It does not
need a particular Hermes version pinned at runtime — the pinned commit in this
repository governs *development* of the bridge, not your installation.

### Where Hermes may live

Discovery checks these, in order, and stops at the first one carrying upstream's
marker files (`config.yaml`, `.env`, `state.db`):

1. `HERMES_HOME` — set this to point anywhere you like; it wins outright.
2. `%LOCALAPPDATA%\hermes`
3. `%USERPROFILE%\AppData\Local\hermes`
4. `%USERPROFILE%\.hermes`
5. `%ProgramFiles%\Hermes`
6. Platform default root
7. `hermes` resolved from `PATH`
8. A running local endpoint, via the spawn ledger

To use a **custom location**:

```powershell
$env:HERMES_HOME = "D:\tools\hermes"
```

Set it as a persistent user variable if you want Design Studio to find it on
every launch. A directory that merely exists is never treated as an install —
the markers are required.

---

## 2. Install Design Studio

Download from the GitHub Release and verify the checksum first:

```bash
sha256sum -c SHA256SUMS.txt
```

Then run `HermesDesignStudio-Setup-Windows-x64.exe`, or unpack
`HermesDesignStudio-Windows-x64.exe` for a portable install.

The installer:

- installs Design Studio **only**;
- does **not** contain the Hermes source tree;
- does **not** write to your Hermes installation;
- does **not** register the `hermes://` protocol — that stays with Hermes.
  Design Studio registers `hermes-design-studio://`.

---

## 3. States you can land in

**Hermes found and running.** Design Studio connects automatically. Model,
theme and active project flow in; design artifacts and generation status flow
back. No configuration step.

**Hermes found but offline.** The install is detected and shown as *offline*.
Design Studio does not attempt to start it silently in a way that bypasses your
setup; it offers to attach and keeps retrying. Standalone functionality remains
available meanwhile.

**Hermes not installed.** Stated plainly in the UI. Nothing is faked: no stub
model, no synthetic connection. Supported standalone functionality works, and
you can connect later.

**Custom location.** Set `HERMES_HOME` (see above). It takes precedence over
every other probe.

**Temporarily unavailable.** Retries continue in the background. When the
endpoint answers, the connection is established and a resync runs.

**Hermes restarted.** Detected via the control socket's `identify.pid` changing.
Design Studio re-attaches and resyncs; in-flight state is reconciled rather than
discarded.

**Hermes upgraded.** Detected via `install_id` changing. Model and theme
projections are re-read before resuming, because an upgrade may have changed
them.

In every reconnect case, **events that occurred while the link was down are
delivered afterwards** — they are buffered with bounded overflow and drained on
reconnect, so a generation that completed offline still reports.

---

## 4. Deep links

Design Studio registers `hermes-design-studio://`. It also understands the
`hermes://design-studio/...` form that Hermes emits:

```
hermes-design-studio://design-studio
hermes-design-studio://design-studio/project/{id}
hermes-design-studio://design-studio/design/{id}
hermes-design-studio://design-studio/artifact/{id}
hermes-design-studio://design-studio/session/{id}
```

Identifiers containing path traversal are rejected.

---

## 5. Permissions

Hermes' approval mode governs what Design Studio may do on its behalf. The modes
are upstream's — `manual`, `smart`, `off` — scoped per profile and re-read on
every check. If the mode is *managed* by your Hermes administrator it cannot be
overridden here, and Design Studio will not try.

Read-only actions (`open`, `focus`, `preview`, `compare`, `getStatus`,
`getArtifacts`, `listSkills`) are gated separately from actions that invoke
agents (`generate`, `generateVariant`, `critique`), touch the filesystem
(`export`), or leave the machine (`sendToCode`, `handoff`). Denials are reported
to Hermes, never silently worked around. An unreadable or unrecognised mode
denies.

Passwords are never sent to a model. Credentials and raw cookies never reach the
renderer. Auth tokens are never logged.

---

## 6. Development setup

```bash
git clone --recurse-submodules <this repository>
# or, on an existing clone:
git submodule update --init --depth 1 vendor/nous-hermes

pnpm install
node scripts/hermes/verify-upstream-pin.mjs --require-submodule
```

The last command checks the pinned commit against the checkout and verifies that
every upstream module and symbol the bridge cites still exists at that commit,
plus that the gateway control protocol is still version 1. It exits non-zero if
any of that has moved.

If you bump the submodule, re-read the cited symbols at the new commit, update
`HERMES_UPSTREAM_COMMIT` / `HERMES_UPSTREAM_SURFACE` in
`apps/desktop/src/main/hermes/upstream-pin.ts`, and note what changed in
[`hermes-integration.md`](./hermes-integration.md).

### Tests

```bash
cd apps/desktop && pnpm exec vitest run -c vitest.config.ts tests/main/hermes/
cd tools/pack   && pnpm exec vitest run tests/release-artifacts.test.ts
```

The integration suite is Electron-free and never touches a real Hermes install —
it runs against in-memory filesystem and socket doubles, so it passes on a
machine with no Hermes at all.

---

## 7. Attribution

Hermes is © Nous Research, vendored here as a pinned submodule for development
and interface verification. The Rules typefaces in
`apps/web/public/fonts/hermes/` come from that same upstream source.

Nothing in this repository claims ownership of upstream code. Design Studio is a
separate application that integrates with Hermes through its documented
interfaces; it does not redistribute Hermes in any production artifact.
