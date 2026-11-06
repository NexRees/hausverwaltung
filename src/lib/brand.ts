// nexrees: product name and links shown in the UI.
// NexRees runs a modified version of HaVeWa (https://github.com/fgilde/hausverwaltung, AGPL-3.0).
// AGPL-3.0 § 13 requires that every user can get the source of the version they use:
// SOURCE_URL points there and is linked from the info drawer.
// Keep every visible product name here, so upstream merges touch as few files as possible.

export const BRAND = {
  name: "NexRees",
  website: "https://nexrees.de",
  sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/NexRees/hausverwaltung",
  issuesUrl: "https://github.com/NexRees/hausverwaltung/issues",
  upstream: {
    name: "HaVeWa",
    author: "Florian Gilde",
    url: "https://github.com/fgilde/hausverwaltung",
    license: "AGPL-3.0",
  },
} as const;

/** AGPL § 13: link to the exact source of the running build when its commit is known. */
export function sourceUrlFor(sha: string | undefined): string {
  const commit = sha?.trim();
  return commit && /^[0-9a-f]{7,40}$/i.test(commit) ? `${BRAND.sourceUrl}/tree/${commit}` : BRAND.sourceUrl;
}
