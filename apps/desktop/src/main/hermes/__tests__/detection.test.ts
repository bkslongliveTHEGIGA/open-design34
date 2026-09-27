import { describe, it, expect } from "vitest";
import { resolveHermesHome } from "../detection.js";
import { parseHermesDeepLink as parseLink, isValidDeepLinkId as isValid, HermesDeepLinkFactory as Factory } from "../deeplink.js";

describe("Hermes Detection", () => {
  it("resolves Hermes home from env or default", () => {
    const home = resolveHermesHome();
    expect(home).toBeTruthy();
    expect(typeof home).toBe("string");
  });
});

describe("Hermes Deep Links", () => {
  it("parses root deep link", () => {
    const link = parseLink("hermes://design-studio");
    expect(link).not.toBeNull();
    expect(link?.type).toBe("design-studio");
  });

  it("parses project deep link", () => {
    const link = parseLink("hermes://design-studio/project/abc123");
    expect(link).not.toBeNull();
    expect(link?.type).toBe("project");
    expect(link?.id).toBe("abc123");
  });

  it("parses design deep link", () => {
    const link = parseLink("hermes://design-studio/design/design-xyz");
    expect(link).not.toBeNull();
    expect(link?.type).toBe("design");
    expect(link?.id).toBe("design-xyz");
  });

  it("parses artifact deep link", () => {
    const link = parseLink("hermes://design-studio/artifact/art-123");
    expect(link).not.toBeNull();
    expect(link?.type).toBe("artifact");
    expect(link?.id).toBe("art-123");
  });

  it("rejects invalid scheme", () => {
    const link = parseLink("https://design-studio/project/123");
    expect(link).toBeNull();
  });

  it("validates IDs", () => {
    expect(isValid("valid-id_123.test")).toBe(true);
    expect(isValid("invalid id with spaces")).toBe(false);
    expect(isValid("")).toBe(false);
    expect(isValid("a".repeat(129))).toBe(false);
  });

  it("creates deep links", () => {
    expect(Factory.designStudio()).toBe("hermes://design-studio/");
    expect(Factory.project("proj123")).toBe("hermes://design-studio/project/proj123");
    expect(Factory.design("design123")).toBe("hermes://design-studio/design/design123");
    expect(Factory.artifact("art123")).toBe("hermes://design-studio/artifact/art123");
  });

  it("rejects invalid IDs when creating", () => {
    expect(() => Factory.project("invalid id")).toThrow();
  });
});
