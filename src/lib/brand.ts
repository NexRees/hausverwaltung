// nexrees: product name and links shown in the UI.
// NexRees runs a modified version of HaVeWa (https://github.com/fgilde/hausverwaltung, AGPL-3.0).
// AGPL-3.0 § 13 requires that every user can get the source of the version they use. The repository
// is private, so the link goes to /api/source (download for signed-in users) unless
// NEXT_PUBLIC_SOURCE_URL points elsewhere.
// Keep every visible product name here, so upstream merges touch as few files as possible.

export const BRAND = {
  name: "NexRees",
  website: "https://nexrees.de",
  sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL || "/api/source",
  issuesUrl: "https://nexrees.de",
  // Impressum (§ 5 DDG) and privacy notice (Art. 13 DSGVO), linked from login, setup and portal.
  imprintUrl: process.env.NEXT_PUBLIC_IMPRINT_URL || "https://nexrees.de/impressum",
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL || "https://nexrees.de/datenschutz",
  upstream: {
    name: "HaVeWa",
    author: "Florian Gilde",
    url: "https://github.com/fgilde/hausverwaltung",
    license: "AGPL-3.0",
  },
} as const;

/**
 * AGPL § 13: link to the exact source of the running build. /api/source always serves the
 * archive of the running build; an external URL (e.g. a Git host) gets the commit appended.
 */
export function sourceUrlFor(sha: string | undefined): string {
  if (BRAND.sourceUrl.startsWith("/")) return BRAND.sourceUrl;
  const commit = sha?.trim();
  return commit && /^[0-9a-f]{7,40}$/i.test(commit) ? `${BRAND.sourceUrl}/tree/${commit}` : BRAND.sourceUrl;
}
