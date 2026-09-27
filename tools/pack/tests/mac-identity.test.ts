import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { releaseInstallIdentity } from "@open-design/release";

import { PRODUCT_NAME } from "@/mac/constants.js";
import { resolveMacInstallIdentity } from "@/mac/identity.js";

/**
 * Display identity follows `PRODUCT_NAME` / `releaseInstallIdentity(...)`. The
 * `io.open-design.desktop*` appIds are internal identifiers and deliberately do
 * NOT follow the display rename — changing them would break code-signing
 * identity, notarization records and installed users' preferences.
 */
const channelName = (channel: "stable" | "beta" | "preview" | "prerelease"): string =>
  releaseInstallIdentity(channel).productName;
const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
import { resolveMacPaths } from "@/mac/paths.js";

function makeConfig(root: string, namespace: string): ToolPackConfig {
  return {
    containerized: false,
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    namespace,
    platform: "mac",
    portable: true,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      output: {
        appBuilderRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace, "builder"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace),
        platformRoot: join(root, ".tmp", "tools-pack", "out", "mac"),
        root: join(root, ".tmp", "tools-pack", "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces", namespace),
      },
      cacheRoot: join(root, ".tmp", "tools-pack", "cache"),
      toolPackRoot: join(root, ".tmp", "tools-pack"),
    },
    signed: false,
    silent: true,
    to: "dmg",
    webOutputMode: "standalone",
    workspaceRoot: root,
  };
}

describe("resolveMacInstallIdentity", () => {
  it("keeps stable builds on the canonical mac identity", () => {
    expect(resolveMacInstallIdentity(makeConfig("/work", "release-stable"))).toMatchObject({
      appId: "io.open-design.desktop",
      installerTitle: channelName("stable"),
      productName: channelName("stable"),
      publicAppBundleName: `${channelName("stable")}.app`,
      systemAppBundleName: `${channelName("stable")}.app`,
    });
  });

  it("uses first-class beta app identity for beta release namespaces", () => {
    const config = makeConfig("/work", "release-beta");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.open-design.desktop.beta",
      executableName: channelName("beta"),
      installerTitle: channelName("beta"),
      productName: channelName("beta"),
      publicAppBundleName: `${channelName("beta")}.app`,
      systemAppBundleName: `${channelName("beta")}.app`,
    });
    expect(resolveMacPaths(config).appPath).toMatch(new RegExp(`${escaped(channelName("beta"))}\\.app$`));
  });

  it("uses first-class preview app identity for preview release namespaces", () => {
    const config = makeConfig("/work", "release-preview");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.open-design.desktop.preview",
      executableName: channelName("preview"),
      installerTitle: channelName("preview"),
      productName: channelName("preview"),
      publicAppBundleName: `${channelName("preview")}.app`,
      systemAppBundleName: `${channelName("preview")}.app`,
    });
    expect(resolveMacPaths(config).appPath).toMatch(new RegExp(`${escaped(channelName("preview"))}\\.app$`));
  });

  it("uses first-class prerelease app identity for prerelease release versions and namespaces", () => {
    const prereleaseVersionConfig = {
      ...makeConfig("/work", "release-stable"),
      appVersion: "0.8.0-prerelease.2",
    };
    const prereleaseNamespaceConfig = makeConfig("/work", "release-prerelease");

    expect(resolveMacInstallIdentity(prereleaseVersionConfig)).toEqual({
      appId: "io.open-design.desktop.prerelease",
      executableName: channelName("prerelease"),
      installerTitle: channelName("prerelease"),
      productName: channelName("prerelease"),
      publicAppBundleName: `${channelName("prerelease")}.app`,
      systemAppBundleName: `${channelName("prerelease")}.app`,
    });
    expect(resolveMacPaths(prereleaseVersionConfig).appPath).toMatch(new RegExp(`${escaped(channelName("prerelease"))}\\.app$`));
    expect(resolveMacInstallIdentity(prereleaseNamespaceConfig)).toMatchObject({
      productName: channelName("prerelease"),
      publicAppBundleName: `${channelName("prerelease")}.app`,
    });
  });
});
