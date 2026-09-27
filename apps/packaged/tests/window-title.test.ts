import { describe, expect, it } from "vitest";

import { releaseInstallIdentity } from "@open-design/release";

import { resolvePackagedWindowTitle } from "../src/window-title.js";

/**
 * Window titles are the public product name, so they follow
 * `releaseInstallIdentity(...)` rather than a hardcoded string. A rebrand
 * changes the title; this test tracks the source of truth instead of going
 * stale and silently pinning the old name.
 */
const productName = (channel: "stable" | "beta" | "prerelease" | "preview"): string =>
  releaseInstallIdentity(channel).productName;

describe("resolvePackagedWindowTitle", () => {
  it("keeps stable windows on the public product name", () => {
    expect(resolvePackagedWindowTitle({ appVersion: "0.10.0", namespace: "release-stable-win" })).toBe(productName("stable"));
  });

  it("uses channel product names for non-stable release versions", () => {
    expect(resolvePackagedWindowTitle({ appVersion: "0.10.0-beta.1", namespace: "release-beta-win" })).toBe(productName("beta"));
    expect(resolvePackagedWindowTitle({ appVersion: "0.10.0-prerelease.1", namespace: "release-prerelease-win" })).toBe(productName("prerelease"));
    expect(resolvePackagedWindowTitle({ appVersion: "0.10.0-preview.1", namespace: "release-preview-win" })).toBe(productName("preview"));
  });

  it("falls back to official release namespaces when app version is unavailable", () => {
    expect(resolvePackagedWindowTitle({ appVersion: null, namespace: "release-beta-win" })).toBe(productName("beta"));
    expect(resolvePackagedWindowTitle({ appVersion: null, namespace: "release-prerelease-win" })).toBe(productName("prerelease"));
    expect(resolvePackagedWindowTitle({ appVersion: null, namespace: "release-preview-win" })).toBe(productName("preview"));
  });

  it("keeps ad hoc namespaces on the default window title", () => {
    expect(resolvePackagedWindowTitle({ appVersion: null, namespace: "beta-local-flow" })).toBe(productName("stable"));
  });
});
