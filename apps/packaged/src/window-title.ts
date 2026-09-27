import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";

/**
 * Window title for ad hoc namespaces that map to no release channel.
 *
 * Derived from the stable release identity rather than a literal, so it tracks
 * `PRODUCT_NAME` in `packages/release` — a hardcoded "Open Design" here kept the
 * title bar on the old name after the product was renamed.
 */
const DEFAULT_WINDOW_TITLE = releaseInstallIdentity("stable").productName;

export function resolvePackagedWindowTitle(config: { appVersion: string | null; namespace: string }): string {
  const channel =
    releaseChannelFromVersion(config.appVersion) ??
    releaseChannelFromNamespace(config.namespace);
  return channel == null ? DEFAULT_WINDOW_TITLE : releaseInstallIdentity(channel).productName;
}
