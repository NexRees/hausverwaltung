import { describe, expect, it } from "vitest";
import { loginUrlFor, safeCallbackPath } from "./safe-redirect";

const LOCALES = ["de", "en", "pt-BR"] as const;

describe("safeCallbackPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeCallbackPath("/de/units")).toBe("/de/units");
    expect(safeCallbackPath("/de/units?page=2&q=M%C3%BCller")).toBe("/de/units?page=2&q=M%C3%BCller");
    expect(safeCallbackPath("/en/leases/abc#docs")).toBe("/en/leases/abc#docs");
    expect(safeCallbackPath("  /de/portal ")).toBe("/de/portal");
  });

  it("normalises dot segments", () => {
    expect(safeCallbackPath("/de/units/../leases")).toBe("/de/leases");
  });

  it("rejects other origins and schemes", () => {
    for (const bad of [
      "https://evil.example/de/units",
      "//evil.example/x",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "de/units",
      "",
      "   ",
      "/\t/evil.example",
      "/\n/evil.example",
      // Dot segments that normalise into a protocol-relative URL.
      "/..//evil.example",
      "/.//evil.example",
      "/%2e//evil.example",
      "/%2e%2e//evil.example",
      "/.%2e//evil.example",
      "/de/..//evil.example",
      "/de/%2e%2e//evil.example/x",
    ]) {
      expect(safeCallbackPath(bad), bad).toBeNull();
    }
  });

  it("rejects non-strings and overlong values", () => {
    expect(safeCallbackPath(undefined)).toBeNull();
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(["/de/units"])).toBeNull();
    expect(safeCallbackPath(`/de/${"a".repeat(3000)}`)).toBeNull();
  });

  it("never returns to the login, setup or API", () => {
    for (const loop of ["/login", "/de/login", "/de/login?callbackUrl=%2Fde", "/pt-BR/setup", "/api/auth/signin", "/de/units/../login"]) {
      expect(safeCallbackPath(loop), loop).toBeNull();
    }
    expect(safeCallbackPath("/de/login-history")).toBe("/de/login-history");
  });
});

describe("loginUrlFor", () => {
  it("sends the user to the login of the page's locale with the page as callbackUrl", () => {
    expect(loginUrlFor("/de/units", LOCALES)).toBe("/de/login?callbackUrl=%2Fde%2Funits");
    expect(loginUrlFor("/pt-BR/leases?page=3", LOCALES)).toBe("/pt-BR/login?callbackUrl=%2Fpt-BR%2Fleases%3Fpage%3D3");
  });

  it("drops the callback for the locale root", () => {
    expect(loginUrlFor("/en", LOCALES)).toBe("/en/login");
    expect(loginUrlFor("/en/", LOCALES)).toBe("/en/login");
  });

  it("falls back to /login without a safe path", () => {
    expect(loginUrlFor(null, LOCALES)).toBe("/login");
    expect(loginUrlFor("//evil.example", LOCALES)).toBe("/login");
    expect(loginUrlFor("/de/..//evil.example", LOCALES)).toBe("/login");
    expect(loginUrlFor("/de/login", LOCALES)).toBe("/login");
  });

  it("keeps the callback when the path has no known locale", () => {
    expect(loginUrlFor("/fr/units", LOCALES)).toBe("/login?callbackUrl=%2Ffr%2Funits");
  });
});
