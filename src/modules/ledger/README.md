# General ledger (NexRees)

Copyright (c) 2026 NexRees.

Double-entry bookkeeping for the property management app: every rent charge, payment and reserve
movement is posted as a balanced entry into an append-only journal with a hash chain. The module is
built so it can be lifted out of this application.

## Boundaries

| Part | Files | Knows the host app? |
|---|---|---|
| Core schema and functions | `prisma/migrations/20261110160000_nexrees_ledger_core` | No. Tables `LedgerAccount`, `JournalEntry`, `JournalLine`, `LedgerChain`; the only writer `nexrees_ledger_post()` |
| Core logic | `core.ts` (+ `core.test.ts`) | No. Talks to the database through the `LedgerDb` port (one method, `query`) |
| Glue | `prisma/migrations/20261110160100_nexrees_ledger_havewa`, `havewa.ts`, `actions.ts`, `ui/` | Yes. Posting triggers on `Charge`, `Payment`, `ReserveTransaction`; period close; roles; forms |

The core migration defines three port functions as stubs; the glue migration replaces them:
`nexrees_ledger_locked_until(tenant)` (closed period), `nexrees_ledger_bank_account(tenant, id)`
(ledger account of a bank account), `nexrees_ledger_ensure_chart(tenant)`.

Call sites in host files are listed in `NEXREES.md` (row "General ledger").

## How it works

- Documents stay what they are (`Charge`, `Payment`, `ReserveTransaction`). Postgres triggers post
  them in the same transaction, so UI, API, MCP, bank sync and imports cannot bypass the ledger.
- A changed or deleted document posts a Storno (an entry with the sides swapped, `reversesId`) and,
  for a change, a new entry. Journal rows are never updated or deleted.
- One chart of accounts per company, created on first use. One ledger account per bank account
  (1201 ff.). The property is carried on the entry, lease and person on the line.
- Each entry gets a gapless number per company (`seq`) and `hash = SHA-256(prevHash, entry, lines)`.
  `nexrees_ledger_verify(tenant)` recomputes the chain and names the first entry that does not fit.
- Entries cannot be dated into a closed period (`Tenant.bookingsLockedUntil`).
- Free entries ("Buchung erfassen") cover what has no document yet. They can be cancelled with a
  Storno; entries that belong to a document cannot, the document has to be changed.

## Posting rules

| Document | Debit | Credit |
|---|---|---|
| Charge (rent, service charges, Hausgeld, other) | 1400 Debtors | 8100 / 8200 / 8300 / 8900 income |
| Charge of type deposit | 1400 Debtors | 1700 Deposits held |
| Incoming payment, matched to a lease | Bank | 1400 Debtors |
| Incoming payment, not matched | Bank | 1591 Unallocated receipts |
| Outgoing payment, matched to a lease (refund) | 1400 Debtors | Bank |
| Outgoing payment, not matched | 1590 Unallocated payments | Bank |
| Reserve allocation | 4950 Allocation to reserve | 0950 Maintenance reserve |

Negative amounts post with the sides swapped. Entry date: the charge's period, the payment's date.

## Limits (known, on purpose)

- The account numbers are our own starting chart, not SKR03/SKR04/SKR49. A tax adviser has to
  confirm the chart and the DATEV mapping before the export is used for a real client.
- Costs (`CostEntry`) and the deposit register (`Deposit`) are not posted yet. Outgoing payments
  land on 1590 until the incoming-invoice workflow assigns them to an expense account.
- No VAT, no cost centres, no opening balances wizard, no year-end closing entries.
- The hash chain proves the journal was not altered in place. It does not protect against someone
  with database owner rights rebuilding the whole chain; that needs the head hash stored outside
  the database (planned: S3 Object Lock in Frankfurt).
- `nexrees_ledger_rebuild(tenant)` exists for test data only and runs only in purge mode.

## Tests

- `npx vitest run src/modules/ledger/core.test.ts`
- `NEXREES_DB_TEST=1 DATABASE_URL=… npx vitest run src/modules/ledger/ledger.db.test.ts`
  (needs a migrated Postgres; CI runs it in "Seed check")
