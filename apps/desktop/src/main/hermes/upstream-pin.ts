// The Hermes upstream pin this bridge was written against.
//
// Every discovery path, transport, protocol verb and payload field in this
// directory was read out of the vendored Hermes source at this exact commit
// (`vendor/nous-hermes`). Nothing here is inferred from documentation alone and
// nothing is guessed: `docs/hermes-integration.md` cites the upstream file and
// symbol for each entry below.
//
// When the submodule is bumped, `scripts/hermes/verify-upstream-pin.mjs`
// re-reads these symbols from the submodule and fails the build if the shape
// the bridge depends on has moved. That check is what makes the pin load
// bearing rather than decorative.

/** Upstream repository the submodule tracks. */
export const HERMES_UPSTREAM_REPO = "https://github.com/NousResearch/hermes-agent.git";

/** Submodule path inside this repository. */
export const HERMES_UPSTREAM_SUBMODULE_PATH = "vendor/nous-hermes";

/**
 * Pinned upstream commit (`vendor/nous-hermes` gitlink).
 *
 * `main` HEAD at the time the bridge landed. Bumping this is a reviewed change:
 * run `scripts/hermes/verify-upstream-pin.mjs` and re-read the cited symbols.
 */
export const HERMES_UPSTREAM_COMMIT = "6f7a7991bb069db07ae74a479823ce8310f8c7e0";

/**
 * The upstream surface this bridge actually consumes.
 *
 * Kept as data so the verification script can assert each entry still exists at
 * the pinned commit without re-deriving it, and so a reader can see the whole
 * dependency on Hermes at a glance.
 */
export const HERMES_UPSTREAM_SURFACE = Object.freeze({
  /** `HERMES_HOME` → context override → platform default; `HERMES_DATA_DIR_SUFFIX`. */
  hermesHome: {
    module: "hermes_constants.py",
    symbols: [
      "get_hermes_home",
      "get_process_hermes_home",
      "_get_platform_default_hermes_home",
      "get_default_hermes_root",
      "_HERMES_HOME_MARKERS",
    ],
  },
  /** Machine-wide spawn ledger written after a backend binds its socket. */
  spawnLedger: {
    module: "hermes_cli/process_identity.py",
    symbols: ["LEDGER_FILENAME", "LedgerEntry", "REAPABLE_PURPOSES", "register_self"],
  },
  /** Attach-first host backend discovery (the Desktop half of the same rule). */
  backendDiscovery: {
    module: "apps/desktop/electron/backend-discovery.ts",
    symbols: [
      "SPAWN_LEDGER_FILENAME",
      "HostBackendRecord",
      "parseSpawnLedger",
      "spawnOrAttach",
      "recordBaseUrl",
    ],
  },
  /** Gateway control socket: the local-only liveness/identity surface. */
  controlSocket: {
    module: "gateway/control_socket.py",
    symbols: [
      "CONTROL_PROTOCOL_VERSION",
      "_SOCKET_FILENAME",
      "_POINTER_FILENAME",
      "windows_pipe_name",
      "resolve_client_socket_path",
      "build_identify_payload",
      "build_status_payload",
      "query_gateway_control",
      "identify_gateway",
    ],
  },
  /** Loopback dashboard session token + REST/WS auth convention. */
  dashboardAuth: {
    module: "hermes_cli/web_server.py",
    symbols: ["_resolve_session_token", "_SESSION_TOKEN", "_has_valid_session_token"],
  },
  dashboardTokenPublish: {
    module: "hermes_cli/web_server_dashboard.py",
    symbols: ["window.__HERMES_SESSION_TOKEN__"],
  },
  desktopConnection: {
    module: "apps/desktop/electron/connection-config.ts",
    symbols: ["X-Hermes-Session-Token", "?token="],
  },
  /** `hermes://` deep links: host is the kind, pathname is the name. */
  deepLinks: {
    module: "apps/desktop/electron/main.ts",
    symbols: ["HERMES_PROTOCOL", "DEEPLINK_SCHEMES", "handleDeepLink"],
  },
} as const);

/**
 * The protocol revision of the gateway control socket the bridge speaks.
 *
 * Mirrors `gateway/control_socket.py::CONTROL_PROTOCOL_VERSION`. A response
 * carrying a different `protocol` value is treated as an incompatible peer:
 * the bridge refuses to trust the payload rather than half-interpreting it.
 */
export const HERMES_CONTROL_PROTOCOL_VERSION = 1;
