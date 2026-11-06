// nexrees: product name and links shown in the UI.
// NexRees runs a modified version of HaVeWa (https://github.com/fgilde/hausverwaltung, AGPL-3.0).
// AGPL-3.0 § 13 requires that every user can get the source of the version they use:
// SOURCE_URL points there and is linked from the info drawer and the login page.
// Keep every visible product name here, so upstream merges touch as few files as possible.

export const BRAND = {
  name: "NexRees",
  website: "https://nexrees.de",
  sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/NexRees/nexrees-hv",
  issuesUrl: "https://github.com/NexRees/nexrees-hv/issues",
  upstream: {
    name: "HaVeWa",
    author: "Florian Gilde",
    url: "https://github.com/fgilde/hausverwaltung",
    license: "AGPL-3.0",
  },
} as const;
