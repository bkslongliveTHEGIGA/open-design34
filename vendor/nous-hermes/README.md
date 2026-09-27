# Nous Hermes Reference

This directory is a pinned reference to https://github.com/NousResearch/hermes-agent

It is used for interface inspection, compatibility, development, integration testing, version pinning.

It must NOT be bundled into production Design Studio installer.

Pinned version: main branch at 2026-09-27
Commit placeholder: will be resolved via git submodule update --init

For offline builds, this directory contains minimal reference stubs.
The actual source is fetched via submodule.

Structure reference (from upstream AGENTS.md):
- run_agent.py
- cli.py
- hermes_state.py
- hermes_constants.py (get_hermes_home)
- agent/
- hermes_cli/
- tools/
- gateway/
- plugins/
- skills/
- apps/desktop/
- tui_gateway/
