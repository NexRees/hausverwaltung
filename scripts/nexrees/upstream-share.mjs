#!/usr/bin/env node
// Copyright (c) 2026 NexRees. Part of the NexRees platform.
//
// How much of this repository is still HaVeWa code? NexRees replaces HaVeWa area by area
// (Go core, fresh UI); this report tracks the share until it reaches zero.
//
// Each tracked text file is put in one of three classes, by comparing it with
// docs/nexrees/upstream-manifest.tsv (path + git blob of every file in the HaVeWa commit we
// started from):
//   upstream  the file is byte-identical to a HaVeWa file (any path, so moves are caught)
//   modified  the path exists in HaVeWa and the file was changed: counted as HaVeWa-derived
//   nexrees   new file
// "modified" is counted whole, on purpose: a file that keeps any HaVeWa code is not ours yet.
// Limits: a HaVeWa file that was both moved and edited counts as "nexrees"; the legal review
// before relicensing must use a similarity scan, not this report.
//
// Usage: node scripts/nexrees/upstream-share.mjs [--json] [--max-share <percent>]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MANIFEST = "docs/nexrees/upstream-manifest.tsv";
const SKIP = /(^|\/)package-lock\.json$|^docs\/nexrees\/upstream-manifest\.tsv$|\.(png|jpe?g|gif|webp|ico|svg|mp4|webm|woff2?|ttf|otf|pdf|zip|gz)$/i;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const maxIdx = args.indexOf("--max-share");
const maxShare = maxIdx >= 0 ? Number(args[maxIdx + 1]) : null;

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const manifestPaths = new Set();
const manifestBlobs = new Set();
for (const line of readFileSync(MANIFEST, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [path, blob] = line.split("\t");
  manifestPaths.add(path);
  manifestBlobs.add(blob);
}

/** Area = top-level folder, or the second level inside src/ and prisma/. */
function areaOf(path) {
  const parts = path.split("/");
  if ((parts[0] === "src" || parts[0] === "prisma") && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts.length > 1 ? parts[0] : "(root)";
}

function lineCount(blob) {
  const text = git("cat-file", "-p", blob);
  if (text.includes("\u0000")) return null; // binary
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

const areas = new Map();
const total = { upstream: 0, modified: 0, nexrees: 0 };
for (const row of git("ls-files", "-s").split("\n")) {
  if (!row) continue;
  const [meta, path] = row.split("\t");
  if (SKIP.test(path)) continue;
  const blob = meta.split(" ")[1];
  const lines = lineCount(blob);
  if (lines === null) continue;
  const cls = manifestBlobs.has(blob) ? "upstream" : manifestPaths.has(path) ? "modified" : "nexrees";
  const area = areaOf(path);
  const a = areas.get(area) ?? { upstream: 0, modified: 0, nexrees: 0, files: 0 };
  a[cls] += lines;
  a.files += 1;
  areas.set(area, a);
  total[cls] += lines;
}

const pct = (a) => {
  const all = a.upstream + a.modified + a.nexrees;
  return all ? (100 * (a.upstream + a.modified)) / all : 0;
};
const share = pct(total);

if (asJson) {
  console.log(JSON.stringify({ share: Number(share.toFixed(2)), total, areas: Object.fromEntries(areas) }, null, 2));
} else {
  const rows = [...areas.entries()].sort((x, y) => (y[1].upstream + y[1].modified) - (x[1].upstream + x[1].modified));
  console.log(`## HaVeWa share: ${share.toFixed(1)} %\n`);
  console.log(`Lines in files that are HaVeWa code, unchanged or modified, out of all tracked text lines.\n`);
  console.log("| Area | HaVeWa unchanged | HaVeWa modified | NexRees | HaVeWa share |");
  console.log("|---|---:|---:|---:|---:|");
  for (const [area, a] of rows) {
    console.log(`| ${area} | ${a.upstream} | ${a.modified} | ${a.nexrees} | ${pct(a).toFixed(0)} % |`);
  }
  console.log(`| **Total** | ${total.upstream} | ${total.modified} | ${total.nexrees} | **${share.toFixed(1)} %** |`);
}

// Ratchet: CI can fail when the share grows past the last recorded value.
if (maxShare !== null && Number.isFinite(maxShare) && share > maxShare + 0.05) {
  console.error(`HaVeWa share ${share.toFixed(1)} % is above the allowed ${maxShare} %.`);
  process.exit(1);
}
