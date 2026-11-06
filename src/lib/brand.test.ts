// nexrees: branding guard. Runs in every upstream sync pull request, so a HaVeWa update cannot
// silently bring back the HaVeWa name, logo or video, or drop the AGPL notices.
// When this fails after an upstream merge: re-apply the NexRees version (see NEXREES.md).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BRAND, sourceUrlFor } from "./brand";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p));

// Our brand assets. Changing a logo on purpose = update its hash here in the same commit.
const ASSETS: Record<string, string> = {
  "public/logo.png": "90408e113214812e57fffe12dba01478e795ddea7a9ab8811b1c2fafa9260927",
  "public/icon.png": "9ec65b1dd8675b3a02e5d4edc87206182c88ba0eca92da2d77134da51fd8f84b",
  "public/marketing/icon.png": "72921117dba24801173931669337107efe0747e392584e28fa5c2879ea704dde",
  "src/app/icon.png": "03c382f598a892418fb8056e1449bca09f9b92473f6bd8e21d07d3b888c44013",
};

// Places where "HaVeWa" is meant to be visible: the credit to the project we build on.
const ALLOWED_PHRASES = ["basiert auf HaVeWa"];
const ALLOWED_MESSAGE_KEYS = new Set(["about.madeBy", "about.basedOn"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** Source text without comments (line, block and JSX comments). */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function flatten(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  );
}

describe("NexRees branding survives upstream merges", () => {
  it("shows no HaVeWa name in the app code (comments and the credit excepted)", () => {
    const hits = walk("src")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(path.join("lib", "brand.ts")))
      .flatMap((f) =>
        stripComments(read(f).toString())
          .split("\n")
          .filter((l) => l.includes("HaVeWa") && !ALLOWED_PHRASES.some((p) => l.includes(p)))
          .map((l) => `${f}: ${l.trim()}`),
      );
    expect(hits).toEqual([]);
  });

  it("shows no HaVeWa name in the translations except the credit", () => {
    const hits = readdirSync(path.join(ROOT, "messages"))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) =>
        flatten(JSON.parse(read(path.join("messages", f)).toString()))
          .filter(([k, v]) => v.includes("HaVeWa") && !ALLOWED_MESSAGE_KEYS.has(k))
          .map(([k]) => `${f}: ${k}`),
      );
    expect(hits).toEqual([]);
  });

  it("keeps the NexRees logos", () => {
    const changed = Object.entries(ASSETS)
      .filter(([f, hash]) => createHash("sha256").update(read(f)).digest("hex") !== hash)
      .map(([f]) => f);
    expect(changed).toEqual([]);
  });

  it("has no login background video (upstream's shows a HaVeWa sign)", () => {
    const dir = path.join(ROOT, "public", "videos");
    expect(existsSync(dir) ? readdirSync(dir).filter((f) => /\.(mp4|webm)$/i.test(f)) : []).toEqual([]);
  });

  it("keeps the AGPL license, the dual-licensing terms and our modification notice", () => {
    expect(read("LICENSE").toString()).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(read("LICENSING.md").toString()).toContain("Florian Gilde");
    expect(read("NOTICE").toString()).toContain("modified version of HaVeWa");
    expect(JSON.parse(read("package.json").toString()).license).toBe("AGPL-3.0-only");
  });

  it("links users to the source of the exact running version (AGPL § 13)", () => {
    expect(BRAND.name).toBe("NexRees");
    expect(BRAND.sourceUrl).toMatch(/^https:\/\/github\.com\/NexRees\//);
    expect(sourceUrlFor("cb13079")).toBe(`${BRAND.sourceUrl}/tree/cb13079`);
    expect(sourceUrlFor("")).toBe(BRAND.sourceUrl);
    expect(sourceUrlFor("main; rm -rf")).toBe(BRAND.sourceUrl);
  });
});
