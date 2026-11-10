-- Copyright (c) 2026 NexRees. Part of the NexRees ledger module (src/modules/ledger).
-- nexrees: double-entry general ledger (doppelte Buchführung), core.
--
-- This migration is self-contained: its tables and functions reference no table of the host
-- application. What ties the ledger to HaVeWa's documents (Charge, Payment, ReserveTransaction,
-- Tenant, Account) is in the next migration, 20261110160100_nexrees_ledger_havewa.
--
-- 1. LedgerAccount: one chart of accounts per company. Accounts with a `key` are the ones the
--    automatic postings use; they are created on first use from nexrees_ledger_default_chart().
--    Every bank Account gets its own ledger account (key 'ACC:<Account.id>').
-- 2. JournalEntry + JournalLine: append-only. Rows can only be written by nexrees_ledger_post()
--    and never changed or deleted. A changed or deleted document posts a Storno (the reversed
--    entry, linked by "reversesId") and, for a change, the new entry.
-- 3. Each entry carries the property (Buchungskreis) and each line the lease/person (debtor), so
--    balances can be read per property and per tenant without separate charts.
-- 4. Tamper evidence: entries are numbered without gaps per company ("seq") and chained by
--    SHA-256 over the previous hash and the full content of the entry and its lines.
--    nexrees_ledger_verify() recomputes the chain.
-- 5. The period close of the host applies to journal entries as well (nexrees_ledger_locked_until).
-- Escape hatch: nexrees.purge = 'on' (company deletion, generated test data); nexrees_purging()
-- comes from 20261109210000_nexrees_bookkeeping_integrity and is redefined here unchanged so the
-- core does not depend on it.

CREATE OR REPLACE FUNCTION nexrees_purging() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('nexrees.purge', true), '') = 'on'
$$;

CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
CREATE TYPE "JournalKind" AS ENUM ('BOOKING', 'STORNO');

CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "key" TEXT,
    "datevNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccount_tenantId_number_key" ON "LedgerAccount"("tenantId", "number");
CREATE UNIQUE INDEX "LedgerAccount_tenantId_key_key" ON "LedgerAccount"("tenantId", "key");

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "propertyId" TEXT,
    "sourceTable" TEXT,
    "sourceId" TEXT,
    "kind" "JournalKind" NOT NULL DEFAULT 'BOOKING',
    "reversesId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "source" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JournalEntry_tenantId_seq_key" ON "JournalEntry"("tenantId", "seq");
CREATE UNIQUE INDEX "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");
CREATE INDEX "JournalEntry_tenantId_date_idx" ON "JournalEntry"("tenantId", "date");
CREATE INDEX "JournalEntry_tenantId_sourceTable_sourceId_idx" ON "JournalEntry"("tenantId", "sourceTable", "sourceId");
CREATE INDEX "JournalEntry_tenantId_propertyId_idx" ON "JournalEntry"("tenantId", "propertyId");

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "personId" TEXT,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalLine_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0) <> ("credit" = 0))
);
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_tenantId_accountId_idx" ON "JournalLine"("tenantId", "accountId");
CREATE INDEX "JournalLine_tenantId_leaseId_idx" ON "JournalLine"("tenantId", "leaseId");

-- One row per company: the lock that serialises its postings, so numbering has no gaps and each
-- entry is chained to the one before. Never updated (the head is the last JournalEntry).
CREATE TABLE "LedgerChain" (
    "tenantId" TEXT NOT NULL,
    CONSTRAINT "LedgerChain_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "JournalEntry"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Deferred: when a whole company is deleted, accounts and lines go in one statement and the
-- check must wait until both are gone. Outside of that an account with postings cannot be deleted.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "JournalEntry" ALTER CONSTRAINT "JournalEntry_reversesId_fkey" DEFERRABLE INITIALLY DEFERRED;

-- ---------- append-only ----------

CREATE OR REPLACE FUNCTION nexrees_ledger_posting() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('nexrees.ledger_posting', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION nexrees_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' OR TG_TABLE_NAME = 'LedgerChain' THEN
    -- rows are written by nexrees_ledger_post() only
    IF nexrees_ledger_posting() THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'NEXREES_LEDGER_IMMUTABLE: Buchungen entstehen nur über nexrees_ledger_post()'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE EXCEPTION 'NEXREES_LEDGER_IMMUTABLE: Journalbuchungen können nicht geändert oder gelöscht werden; Korrekturen erfolgen per Storno'
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER nexrees_ledger_append_only BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_append_only();
CREATE TRIGGER nexrees_ledger_append_only BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_append_only();
CREATE TRIGGER nexrees_ledger_append_only BEFORE INSERT OR UPDATE OR DELETE ON "LedgerChain"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_append_only();

-- An account that has postings keeps its type and its role; number and name stay editable.
CREATE OR REPLACE FUNCTION nexrees_ledger_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN NEW;
  END IF;
  IF (NEW."type" IS DISTINCT FROM OLD."type" OR NEW."key" IS DISTINCT FROM OLD."key" OR NEW."tenantId" <> OLD."tenantId")
     AND EXISTS (SELECT 1 FROM "JournalLine" WHERE "accountId" = OLD."id") THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_ACCOUNT_USED: Kontoart und Funktion eines bebuchten Kontos können nicht geändert werden'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER nexrees_ledger_account_guard BEFORE UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_account_guard();

-- ---------- chart of accounts ----------

-- Starting chart for the automatic postings. Numbers and names can be changed per company;
-- the `key` is what the postings look up.
CREATE OR REPLACE FUNCTION nexrees_ledger_default_chart()
RETURNS TABLE(key text, number text, name text, type "LedgerAccountType") LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('RESERVE',         '0950', 'Erhaltungsrücklage',                        'EQUITY'::"LedgerAccountType"),
    ('BANK',            '1200', 'Bank (ohne Kontozuordnung)',                'ASSET'),
    ('DEBTORS',         '1400', 'Forderungen aus Mieten und Hausgeld',       'ASSET'),
    ('SUSPENSE_OUT',    '1590', 'Noch nicht zugeordnete Zahlungsausgänge',   'ASSET'),
    ('SUSPENSE_IN',     '1591', 'Ungeklärte Zahlungseingänge',               'LIABILITY'),
    ('DEPOSITS',        '1700', 'Erhaltene Kautionen',                       'LIABILITY'),
    ('RESERVE_ALLOC',   '4950', 'Zuführung zur Erhaltungsrücklage',          'EXPENSE'),
    ('INCOME_RENT',     '8100', 'Mieterlöse',                                'INCOME'),
    ('INCOME_NK',       '8200', 'Betriebskostenvorauszahlungen',             'INCOME'),
    ('INCOME_HAUSGELD', '8300', 'Hausgeld',                                  'INCOME'),
    ('INCOME_OTHER',    '8900', 'Sonstige Erlöse',                           'INCOME'),
    ('OPENING',         '9000', 'Saldenvorträge',                            'EQUITY')
$$;

-- Ledger account for a role key; created from the default chart when missing.
CREATE OR REPLACE FUNCTION nexrees_ledger_account(p_tenant text, p_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
  d record;
  v_number text;
BEGIN
  SELECT "id" INTO v_id FROM "LedgerAccount" WHERE "tenantId" = p_tenant AND "key" = p_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT * INTO d FROM nexrees_ledger_default_chart() c WHERE c.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_ACCOUNT: unbekanntes Systemkonto %', p_key USING ERRCODE = 'P0001';
  END IF;
  v_number := d.number;
  IF EXISTS (SELECT 1 FROM "LedgerAccount" WHERE "tenantId" = p_tenant AND "number" = v_number) THEN
    v_number := p_key; -- the number is taken by an own account: keep both, the user renumbers
  END IF;
  v_id := gen_random_uuid()::text;
  INSERT INTO "LedgerAccount" ("id", "tenantId", "number", "name", "type", "key")
  VALUES (v_id, p_tenant, v_number, d.name, d.type, p_key)
  ON CONFLICT ("tenantId", "key") DO NOTHING;
  SELECT "id" INTO v_id FROM "LedgerAccount" WHERE "tenantId" = p_tenant AND "key" = p_key;
  RETURN v_id;
END $$;

-- ---------- ports to the host application ----------
-- The core knows nothing about the host's tables. The host migration replaces these two
-- functions (20261110160100_nexrees_ledger_havewa).

-- Last day of the closed period of a company (NULL = nothing closed). The host version also
-- takes the lock that keeps a concurrent period close out.
CREATE OR REPLACE FUNCTION nexrees_ledger_locked_until(p_tenant text) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT NULL::date
$$;

-- Ledger account for a line that names a bank account of the host ("bank": id or null).
CREATE OR REPLACE FUNCTION nexrees_ledger_bank_account(p_tenant text, p_account text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN nexrees_ledger_account(p_tenant, 'BANK');
END $$;

-- Whole default chart for a company (so the accountant sees it before the first posting).
CREATE OR REPLACE FUNCTION nexrees_ledger_ensure_chart(p_tenant text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d record;
BEGIN
  PERFORM set_config('nexrees.ledger_posting', 'on', true);
  INSERT INTO "LedgerChain" ("tenantId") VALUES (p_tenant) ON CONFLICT DO NOTHING;
  PERFORM set_config('nexrees.ledger_posting', '', true);
  PERFORM 1 FROM "LedgerChain" WHERE "tenantId" = p_tenant FOR UPDATE;
  FOR d IN SELECT c.key FROM nexrees_ledger_default_chart() c LOOP
    PERFORM nexrees_ledger_account(p_tenant, d.key);
  END LOOP;
END $$;

-- ---------- hash chain ----------

CREATE OR REPLACE FUNCTION nexrees_ledger_hash(
  p_prev text, p_id text, p_tenant text, p_seq int, p_date date, p_text text, p_property text,
  p_src_table text, p_src_id text, p_kind text, p_reverses text,
  p_user_id text, p_user_name text, p_source text, p_created timestamp, p_lines jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_prev, p_id, p_tenant, p_seq, to_char(p_date, 'YYYY-MM-DD'), p_text, p_property,
    p_src_table, p_src_id, p_kind, p_reverses, p_user_id, p_user_name, p_source,
    to_char(p_created, 'YYYY-MM-DD"T"HH24:MI:SS.MS'), p_lines
  )::text, 'UTF8')), 'hex')
$$;

-- Lines of an entry in the form that is hashed: [position, account, debit, credit, lease, person].
CREATE OR REPLACE FUNCTION nexrees_ledger_hash_lines(p_entry text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_agg(jsonb_build_array(l."position", l."accountId", l."debit"::numeric(14,2)::text, l."credit"::numeric(14,2)::text, l."leaseId", l."personId") ORDER BY l."position")
    FROM "JournalLine" l WHERE l."entryId" = p_entry
$$;

-- Recomputes the chain of a company. "firstBadSeq" is NULL when every entry is intact:
-- numbering without gaps, each entry linked to its predecessor, content matching its hash.
-- "headSeq"/"headHash" identify the last entry; stored outside the database (anchor) they also
-- prove that nothing was cut off the end.
CREATE OR REPLACE FUNCTION nexrees_ledger_verify(p_tenant text)
RETURNS TABLE(entries int, "firstBadSeq" int, "headSeq" int, "headHash" text) LANGUAGE sql STABLE AS $$
  WITH e AS (
    SELECT j.*,
           lag(j."hash") OVER (ORDER BY j."seq") AS lag_hash,
           row_number() OVER (ORDER BY j."seq") AS rn
      FROM "JournalEntry" j WHERE j."tenantId" = p_tenant
  ), c AS (
    SELECT e."seq", e."hash",
           (e."seq" = e.rn
            AND e."prevHash" = coalesce(e.lag_hash, '')
            AND e."hash" = nexrees_ledger_hash(e."prevHash", e."id", e."tenantId", e."seq", e."date", e."text", e."propertyId",
                  e."sourceTable", e."sourceId", e."kind"::text, e."reversesId", e."userId", e."userName", e."source",
                  e."createdAt", nexrees_ledger_hash_lines(e."id"))) AS ok
      FROM e
  )
  SELECT count(*)::int, (min(c."seq") FILTER (WHERE NOT c.ok))::int, coalesce(max(c."seq"), 0)::int,
         coalesce((SELECT c2."hash" FROM c c2 ORDER BY c2."seq" DESC LIMIT 1), '')
    FROM c
$$;

-- ---------- posting ----------

-- The only writer of the journal. p_lines: [{ "id" | "key" | "bank": account, "debit", "credit",
-- "lease", "person" }, ...] with "id" = LedgerAccount.id, "key" = role key, "bank" = Account.id
-- (null = bank without account). Returns the id of the new entry.
CREATE OR REPLACE FUNCTION nexrees_ledger_post(
  p_tenant text, p_date date, p_text text, p_property text,
  p_src_table text, p_src_id text, p_kind "JournalKind", p_reverses text, p_lines jsonb,
  p_id text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text := coalesce(p_id, gen_random_uuid()::text);
  v_now timestamp(3) := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
  v_locked date;
  v_seq int;
  v_prev text;
  v_hash text;
  v_user_id text := nullif(current_setting('nexrees.user_id', true), '');
  v_user_name text := nullif(current_setting('nexrees.user_name', true), '');
  v_source text := coalesce(nullif(current_setting('nexrees.source', true), ''), 'db');
  v_text text := left(coalesce(nullif(btrim(p_text), ''), 'Buchung'), 500);
  l jsonb;
  v_pos int := 0;
  v_account text;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_sum_d numeric(16,2) := 0;
  v_sum_c numeric(16,2) := 0;
  v_norm jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_was_posting text := coalesce(current_setting('nexrees.ledger_posting', true), '');
  v_head text[];
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Buchungsdatum fehlt' USING ERRCODE = 'P0001';
  END IF;

  -- Same order as the document triggers: company row first (shared), then the chain (exclusive).
  v_locked := nexrees_ledger_locked_until(p_tenant);
  IF v_locked IS NOT NULL AND p_date <= v_locked AND NOT nexrees_purging()
     AND coalesce(current_setting('nexrees.ledger_backfill', true), '') <> 'on' THEN
    RAISE EXCEPTION 'NEXREES_PERIOD_LOCKED: % vom % liegt im festgeschriebenen Zeitraum (bis %)',
      'JournalEntry', to_char(p_date, 'DD.MM.YYYY'), to_char(v_locked, 'DD.MM.YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('nexrees.ledger_posting', 'on', true);
  INSERT INTO "LedgerChain" ("tenantId") VALUES (p_tenant) ON CONFLICT DO NOTHING;
  PERFORM set_config('nexrees.ledger_posting', v_was_posting, true);
  PERFORM 1 FROM "LedgerChain" WHERE "tenantId" = p_tenant FOR UPDATE;
  -- Head of the chain. Within one transaction it is remembered in a transaction-local setting:
  -- the lock above keeps every other writer out until commit, and a bulk run (rent run, import,
  -- backfill) then needs no lookup per entry.
  v_head := string_to_array(coalesce(current_setting('nexrees.ledger_head', true), ''), '|');
  IF v_head[1] = p_tenant THEN
    v_seq := v_head[2]::int;
    v_prev := v_head[3];
  ELSE
    SELECT "seq", "hash" INTO v_seq, v_prev FROM "JournalEntry" WHERE "tenantId" = p_tenant ORDER BY "seq" DESC LIMIT 1;
    v_seq := coalesce(v_seq, 0);
    v_prev := coalesce(v_prev, '');
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_pos := v_pos + 1;
    v_debit := round(coalesce((l->>'debit')::numeric, 0), 2);
    v_credit := round(coalesce((l->>'credit')::numeric, 0), 2);
    IF v_debit < 0 OR v_credit < 0 OR (v_debit = 0) = (v_credit = 0) THEN
      RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Zeile % braucht genau einen positiven Betrag in Soll oder Haben', v_pos
        USING ERRCODE = 'P0001';
    END IF;
    IF l ? 'id' THEN
      SELECT "id" INTO v_account FROM "LedgerAccount" WHERE "id" = l->>'id' AND "tenantId" = p_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Konto in Zeile % gehört nicht zu diesem Mandanten', v_pos
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF l ? 'key' THEN
      v_account := nexrees_ledger_account(p_tenant, l->>'key');
    ELSE
      v_account := nexrees_ledger_bank_account(p_tenant, l->>'bank');
    END IF;
    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
    v_norm := v_norm || jsonb_build_array(jsonb_build_array(v_pos, v_account, v_debit::text, v_credit::text, l->>'lease', l->>'person'));
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('p', v_pos, 'a', v_account, 'd', v_debit, 'c', v_credit, 'l', l->>'lease', 'n', l->>'person'));
  END LOOP;
  IF v_pos < 2 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_UNBALANCED: Soll (%) und Haben (%) müssen gleich sein', v_sum_d, v_sum_c
      USING ERRCODE = 'P0001';
  END IF;

  v_seq := v_seq + 1;
  v_hash := nexrees_ledger_hash(v_prev, v_id, p_tenant, v_seq, p_date, v_text, p_property, p_src_table, p_src_id,
                                p_kind::text, p_reverses, v_user_id, v_user_name, v_source, v_now, v_norm);

  PERFORM set_config('nexrees.ledger_posting', 'on', true);
  INSERT INTO "JournalEntry" ("id", "tenantId", "seq", "date", "text", "propertyId", "sourceTable", "sourceId", "kind",
                              "reversesId", "userId", "userName", "source", "prevHash", "hash", "createdAt")
  VALUES (v_id, p_tenant, v_seq, p_date, v_text, p_property, p_src_table, p_src_id, p_kind,
          p_reverses, v_user_id, v_user_name, v_source, v_prev, v_hash, v_now);
  INSERT INTO "JournalLine" ("id", "tenantId", "entryId", "position", "accountId", "debit", "credit", "leaseId", "personId")
  SELECT v_id || '-' || (r->>'p'), p_tenant, v_id, (r->>'p')::int, r->>'a', (r->>'d')::numeric, (r->>'c')::numeric, r->>'l', r->>'n'
    FROM jsonb_array_elements(v_rows) r;
  PERFORM set_config('nexrees.ledger_posting', v_was_posting, true);
  PERFORM set_config('nexrees.ledger_head', p_tenant || '|' || v_seq || '|' || v_hash, true);
  RETURN v_id;
END $$;

-- Storno of an entry: the same lines with debit and credit swapped, on the original date.
CREATE OR REPLACE FUNCTION nexrees_ledger_reverse(p_tenant text, p_entry text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  e "JournalEntry";
  v_lines jsonb;
BEGIN
  SELECT * INTO e FROM "JournalEntry" WHERE "id" = p_entry AND "tenantId" = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Buchung nicht gefunden' USING ERRCODE = 'P0001';
  END IF;
  IF e."kind" = 'STORNO' THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Eine Stornobuchung kann nicht storniert werden' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE "reversesId" = e."id") THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_INVALID: Buchung % ist bereits storniert', e."seq" USING ERRCODE = 'P0001';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id', l."accountId", 'debit', l."credit", 'credit', l."debit", 'lease', l."leaseId", 'person', l."personId") ORDER BY l."position")
    INTO v_lines FROM "JournalLine" l WHERE l."entryId" = e."id";
  RETURN nexrees_ledger_post(p_tenant, e."date", 'Storno: ' || e."text", e."propertyId", e."sourceTable", e."sourceId", 'STORNO', e."id", v_lines);
END $$;

-- Storno of the entry a document currently stands for (none: nothing to do).
CREATE OR REPLACE FUNCTION nexrees_ledger_reverse_source(p_tenant text, p_table text, p_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_entry text;
BEGIN
  SELECT e."id" INTO v_entry
    FROM "JournalEntry" e
   WHERE e."tenantId" = p_tenant AND e."sourceTable" = p_table AND e."sourceId" = p_id AND e."kind" = 'BOOKING'
     AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reversesId" = e."id")
   ORDER BY e."seq" DESC LIMIT 1;
  IF v_entry IS NOT NULL THEN
    PERFORM nexrees_ledger_reverse(p_tenant, v_entry);
  END IF;
END $$;

