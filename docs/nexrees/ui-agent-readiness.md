# UI/UX and agent-readiness audit

**Date:** 2026-11-09/10 · **Branch:** `claude/project-thread-p9zhy7` · **Data:** demo company and the
2,000-unit scale company (`prisma/scale-seed.ts`, see [scale-test.md](scale-test.md))

Goal: a production-ready, WCAG 2.2 AA conformant app that people and AI agents can both operate:
stable structure, names on every control, machine-readable feedback, and an API/MCP that pages,
validates and explains its errors.

## Method

- Production build, every admin page in the navigation plus record detail pages, login, portal (tenant and owner),
  at 1440 px, 390 px and in dark mode. axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) plus
  probes for page titles, headings, landmarks, unnamed controls, unlabelled inputs, overflow and
  small targets.
- Eight review passes (accessibility, agent UI, agent API, states and errors, language, responsive,
  navigation/performance, portal/sign-in): 144 findings with location and fix.
- After the fixes: the same scan again, plus browser checks of the flows (below).

## Results

| Measure | Before | After |
|---|---|---|
| axe issues, demo data (46 page views) | 469 nodes | 1 node (a horizontally scrolling table on the phone dashboard) |
| axe issues, 2,000-unit data (42 page views) | 854 nodes | 393 nodes, 300 of them small table links on `/finances`, fixed after that run |
| Colour contrast | 81 nodes on 37 pages | 4 nodes on 2 pages (the 10 % destructive tint; token darkened after the run) |
| Landmarks (`main` nested, duplicated, missing) | 39 pages | 0 |
| Unnamed selects / controls | 23 / 28 | 0 / 0 |
| Distinct tab titles across admin pages | 2 | 29 (one per page) |
| Page change announced to screen readers | never (same title everywhere) | every navigation, also when the page streams in |
| Form error keeps the typed input | no (React reset the form) | yes; field marked, focused, German message |
| `GET /api/v1/charges` without paging | 56,871 rows, 7.3 MB, 3.3 s | 5,000 rows + `Link` next page, 0.3–0.4 s |
| MCP `list_charges` default | 11.9 MB | 30 KB (50 rows + `nextOffset`) |

Checked in the browser (Playwright, production build): skip link is the first tab stop; one `main`,
one named main navigation, `aria-current="page"` on the current item; tab title "Einheiten ·
NexRees"; after client navigation to Personen the live region says "Personen"; an empty required
field in "Neues Objekt" shows "Name: Pflichtfeld – bitte ausfüllen.", marks the field
(`aria-invalid`, `aria-describedby`), moves focus to it and keeps the other typed values; closing
with typed input asks "Ungespeicherte Eingaben verwerfen?"; delete buttons read "„EG links“
löschen"; `/de/does-not-exist` answers 404 with a German page; a deleted record keeps the app
shell; the API answers unknown paths with JSON `{error, code}`.

## Contract for agents (and tests)

- **Page identity:** `document.title` is "<Seite> · NexRees"; exactly one visible `h1`.
- **Landmarks:** one `main#main`, one `navigation` "Hauptnavigation", `search` for list filters,
  `navigation` "Seiten" for paging with `rel=prev/next` links.
- **Feedback:** form errors in `role=alert`, fields with `aria-invalid` and `aria-describedby`
  (`<name>-error`); list hit counts in `role=status` with `data-total`.
- **Hooks:** `data-action="delete"` on delete buttons, `data-state="error" | "not-found" |
  "loading"` on page states, `data-route-announcement` for the page-change live region.
- **Server actions** return `{ ok }` or `{ error, fieldErrors }` (`invalid()` in `src/lib/schemas.ts`);
  a delete action may return `{ error }` to refuse with a reason.
- **REST:** `limit`/`offset`, `X-Total-Count`, `Link: rel="next"`, `X-Result-Truncated`;
  errors `{ error, code }`; `GET /api/v1/records/{entity}/{id}`; `GET /api/v1/search?q=`.
- **MCP:** paged list tools (`{items, total, offset, limit, nextOffset}`), `get_record`, `search`,
  tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), closed
  input schemas, `structuredContent`, protocol version negotiation.

## Not done yet (by priority)

| Priority | Item | Note |
|---|---|---|
| P1 | Concurrent edits overwrite each other silently | needs a version column or `updatedAt` check in actions and API |
| P1 | Operation results (rent run, CAMT import, sync) are returned as `error` and dropped by the dialog | small `ActionState.message` addition per action |
| P1 | 19 raw `<form action>` buttons without pending state, error handling or confirmation | move to a shared action button |
| P1 | Entity pickers are native selects with thousands of options at scale | needs a searchable combobox fed by `/api/v1/search` |
| P1 | Unit → lease → renter → charges chain has dead ends | links on detail pages |
| P1 | Data tables on phones: no column priority | per-table work |
| P1 | API: `PATCH /records` replaces the whole record; operations are not idempotent; no rate limit | API design change, own PR |
| P1 | Portal: no password reset, no sign-in throttling, damage report is a bare form, sent statements missing in "Meine Dokumente" | product decisions needed; throttling also a security item |
| P2 | `resolveSsoUser` (`src/lib/sso.ts`) uses an unescaped ILIKE, so `_`/`%` in an IdP e-mail act as wildcards | security; use `escapeLike` as `authorize()` now does |
| P2 | Empty states say "no data yet" under a filter; header action rows do not wrap at 320 px; search hidden on phones | |
| P2 | Bulk sends ("An Mieter mailen", Serien-Mail) run without confirmation or recipient count | |
| P2 | Calendar grid, dashboard chart and PDF preview lack text alternatives; some status only by colour | |
| P2 | Server-side messages (135 action errors, notifications, e-mails) are German only | |
| P3 | Settings tabs not in the URL; no breadcrumbs; Tiptap loads eagerly | |

A soft 404 inside the app (deleted record) still answers HTTP 200: the page streams behind the
loading skeleton, so the status is sent before `notFound()` runs. The page itself is correct and
carries `noindex`.
