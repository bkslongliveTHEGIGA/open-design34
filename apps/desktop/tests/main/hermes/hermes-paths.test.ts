import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  HERMES_HOME_MARKERS,
  expandUserPath,
  fitsUnixSocketPath,
  hermesHomeHash,
  hermesMachineRoot,
  hermesWindowsControlPipeName,
  isHermesHome,
  normalizePathCase,
  platformDefaultHermesHome,
  processHermesHome,
  resolveHermesControlSocketCandidates,
  resolveHermesControlSocketPath,
  resolveHermesControlTransport,
  splitPathEnv,
  windowsHermesHomeCandidates,
  type HermesPathFs,
} from "../../../src/main/hermes/hermes-paths.js";

/** In-memory filesystem so these tests never touch a real Hermes install. */
function memFs(files: Record<string, string | true> = {}): HermesPathFs {
  const present = new Set<string>();
  const contents = new Map<string, string>();
  for (const [path, value] of Object.entries(files)) {
    present.add(path);
    if (typeof value === "string") contents.set(path, value);
  }
  return {
    exists: (path) => present.has(path),
    readText: (path) => (contents.has(path) ? (contents.get(path) as string) : null),
  };
}

describe("platformDefaultHermesHome", () => {
  it("is ~/.hermes on POSIX", () => {
    expect(platformDefaultHermesHome({ platform: "linux", env: {}, homeDir: "/home/ada" })).toBe("/home/ada/.hermes");
    expect(platformDefaultHermesHome({ platform: "darwin", env: {}, homeDir: "/Users/ada" })).toBe("/Users/ada/.hermes");
  });

  it("is %LOCALAPPDATA%\\hermes on Windows", () => {
    expect(
      platformDefaultHermesHome({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
        homeDir: "C:\\Users\\ada",
      }),
    ).toBe("C:\\Users\\ada\\AppData\\Local\\hermes");
  });

  it("falls back to ~/AppData/Local when LOCALAPPDATA is unset", () => {
    expect(
      platformDefaultHermesHome({ platform: "win32", env: {}, homeDir: "C:\\Users\\ada" }),
    ).toBe("C:\\Users\\ada\\AppData\\Local\\hermes");
  });

  it("honours HERMES_DATA_DIR_SUFFIX, which upstream uses for side-by-side instances", () => {
    expect(
      platformDefaultHermesHome({ platform: "linux", env: { HERMES_DATA_DIR_SUFFIX: "-dev" }, homeDir: "/home/ada" }),
    ).toBe("/home/ada/.hermes-dev");
  });
});

describe("processHermesHome", () => {
  it("prefers HERMES_HOME", () => {
    expect(processHermesHome({ platform: "linux", env: { HERMES_HOME: "/srv/hermes" }, homeDir: "/home/ada" })).toBe(
      "/srv/hermes",
    );
  });

  it("treats a whitespace-only HERMES_HOME as unset, matching upstream's .strip()", () => {
    expect(
      processHermesHome({ platform: "linux", env: { HERMES_HOME: "   " }, homeDir: "/home/ada" }),
    ).toBe("/home/ada/.hermes");
  });

  it("expands a leading ~", () => {
    expect(processHermesHome({ platform: "linux", env: { HERMES_HOME: "~/hermes" }, homeDir: "/home/ada" })).toBe(
      "/home/ada/hermes",
    );
  });

  it("falls back to the platform default when unset", () => {
    expect(processHermesHome({ platform: "linux", env: {}, homeDir: "/home/ada" })).toBe("/home/ada/.hermes");
  });
});

describe("hermesMachineRoot", () => {
  it("is the native home when HERMES_HOME is unset", () => {
    expect(hermesMachineRoot({ platform: "linux", env: {}, homeDir: "/home/ada" })).toBe("/home/ada/.hermes");
  });

  it("stays the native home for a profile under it", () => {
    expect(
      hermesMachineRoot({ platform: "linux", env: { HERMES_HOME: "/home/ada/.hermes/profiles/work" }, homeDir: "/home/ada" }),
    ).toBe("/home/ada/.hermes");
  });

  it("steps up two levels for a custom <root>/profiles/<name> layout", () => {
    expect(hermesMachineRoot({ platform: "linux", env: { HERMES_HOME: "/srv/hermes/profiles/work" }, homeDir: "/home/ada" })).toBe(
      "/srv/hermes",
    );
  });

  it("uses the explicit home as the root for a custom non-profile location", () => {
    expect(hermesMachineRoot({ platform: "linux", env: { HERMES_HOME: "/srv/hermes" }, homeDir: "/home/ada" })).toBe(
      "/srv/hermes",
    );
  });
});

describe("home markers", () => {
  it.each([...HERMES_HOME_MARKERS])("accepts a home containing %s", (marker) => {
    expect(isHermesHome("/srv/hermes", memFs({ [join("/srv/hermes", marker)]: true }))).toBe(true);
  });

  it("rejects an arbitrary directory that merely exists", () => {
    expect(isHermesHome("/srv/not-hermes", memFs({ "/srv/not-hermes/readme.md": true }))).toBe(false);
  });
});

describe("control socket addressing", () => {
  it("prefers <home>/gateway.sock", () => {
    const fs = memFs({ "/srv/hermes/gateway.sock": true });
    expect(resolveHermesControlSocketPath("/srv/hermes", fs)).toBe("/srv/hermes/gateway.sock");
  });

  it("follows the gateway.sock.path pointer when the direct socket is absent", () => {
    const fs = memFs({
      "/srv/hermes/gateway.sock.path": "/tmp/hermes-gw-abc.sock",
      "/tmp/hermes-gw-abc.sock": true,
    });
    expect(resolveHermesControlSocketPath("/srv/hermes", fs)).toBe("/tmp/hermes-gw-abc.sock");
  });

  it("ignores a pointer whose target does not exist", () => {
    const fs = memFs({ "/srv/hermes/gateway.sock.path": "/tmp/gone.sock" });
    expect(resolveHermesControlSocketPath("/srv/hermes", fs)).toBeNull();
  });

  it("strips a BOM from the pointer file", () => {
    const fs = memFs({
      "/srv/hermes/gateway.sock.path": "\uFEFF/tmp/hermes-gw-abc.sock\n",
      "/tmp/hermes-gw-abc.sock": true,
    });
    expect(resolveHermesControlSocketPath("/srv/hermes", fs)).toBe("/tmp/hermes-gw-abc.sock");
  });

  it("offers the short temp-dir fallback when the direct path exceeds sun_path", () => {
    const longHome = `/srv/${"h".repeat(120)}/hermes`;
    expect(fitsUnixSocketPath(join(longHome, "gateway.sock"))).toBe(false);
    const candidates = resolveHermesControlSocketCandidates(longHome, { platform: "linux", tmpDir: "/tmp" });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toContain("hermes-gw-");
    expect(candidates.every((candidate) => fitsUnixSocketPath(candidate))).toBe(true);
  });

  it("uses a named pipe on Windows", () => {
    const transport = resolveHermesControlTransport("C:\\Users\\ada\\AppData\\Local\\hermes", memFs(), {
      platform: "win32",
    });
    expect(transport?.kind).toBe("pipe");
  });

  it("returns no transport on POSIX when nothing exists", () => {
    expect(resolveHermesControlTransport("/srv/hermes", memFs(), { platform: "linux" })).toBeNull();
  });
});

describe("hermesHomeHash / windows_pipe_name", () => {
  it("is the first 16 hex of sha256 of the normcased resolved path", () => {
    const home = "/srv/hermes";
    const expected = createHash("sha256").update(home, "utf8").digest("hex").slice(0, 16);
    expect(hermesHomeHash(home, "linux")).toBe(expected);
  });

  it("normcases on Windows so the pipe name matches the server's", () => {
    expect(normalizePathCase("C:/Users/ADA/.hermes", "win32")).toBe("c:\\users\\ada\\.hermes");
    expect(normalizePathCase("/srv/hermes", "linux")).toBe("/srv/hermes");
  });

  it("names the pipe hermes-gateway-<hash>", () => {
    const home = "C:\\Users\\ada\\AppData\\Local\\hermes";
    expect(hermesWindowsControlPipeName(home, "win32")).toBe(`\\\\.\\pipe\\hermes-gateway-${hermesHomeHash(home, "win32")}`);
  });
});

describe("windowsHermesHomeCandidates", () => {
  it("lists the locations upstream actually installs to", () => {
    const candidates = windowsHermesHomeCandidates({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
      homeDir: "C:\\Users\\ada",
    });
    expect(candidates).toContain("C:\\Users\\ada\\AppData\\Local\\hermes");
    expect(candidates).toContain("C:\\Users\\ada\\.hermes");
    expect(candidates).toContain("C:\\Program Files\\Hermes");
  });

  it("is empty off Windows", () => {
    expect(windowsHermesHomeCandidates({ platform: "linux", env: {}, homeDir: "/home/ada" })).toEqual([]);
  });

  it("de-duplicates when LOCALAPPDATA already points at the default", () => {
    const candidates = windowsHermesHomeCandidates({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      homeDir: "C:\\Users\\ada",
    });
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe("path helpers", () => {
  it("splits PATH with the platform separator", () => {
    expect(splitPathEnv("/usr/bin:/bin", "linux")).toEqual(["/usr/bin", "/bin"]);
    expect(splitPathEnv("C:\\bin;C:\\tools", "win32")).toEqual(["C:\\bin", "C:\\tools"]);
  });

  it("drops empty PATH entries", () => {
    expect(splitPathEnv("/usr/bin::/bin", "linux")).toEqual(["/usr/bin", "/bin"]);
  });

  it("expands user paths", () => {
    expect(expandUserPath("~", "/home/ada")).toBe("/home/ada");
    expect(expandUserPath("~/x", "/home/ada")).toBe("/home/ada/x");
    expect(expandUserPath("/abs", "/home/ada")).toBe("/abs");
  });
});
