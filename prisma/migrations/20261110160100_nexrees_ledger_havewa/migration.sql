-- Copyright (c) 2026 NexRees.
-- nexrees: ledger glue for HaVeWa. Connects the ledger core (previous migration) to the host's
-- documents: Charge (Sollstellung), Payment (Zahlung) and ReserveTransaction stay what users work
-- with; database triggers post each of them into the journal, so every writer (UI, /api/v1, MCP,
-- bank sync, imports) is covered and no code path can forget to post. A changed or deleted
-- document posts a Storno and, for a change, the new entry.

ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerChain" ADD CONSTRAINT "LedgerChain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Period close of the company. FOR SHARE: a close that runs concurrently waits for the posting
-- transaction (and vice versa), same as nexrees_period_lock().
CREATE OR REPLACE FUNCTION nexrees_ledger_locked_until(p_tenant text) RETURNS date LANGUAGE plpgsql AS $$
DECLARE
  v_locked date;
BEGIN
  SELECT "bookingsLockedUntil"::date INTO v_locked FROM "Tenant" WHERE "id" = p_tenant FOR SHARE;
  RETURN v_locked;
END $$;

-- Ledger account of a bank Account (own account per bank account, 1201 ff.); NULL = 'BANK'.
CREATE OR REPLACE FUNCTION nexrees_ledger_bank_account(p_tenant text, p_account text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
  v_name text;
  v_next int;
  v_number text;
BEGIN
  IF p_account IS NULL THEN
    RETURN nexrees_ledger_account(p_tenant, 'BANK');
  END IF;
  SELECT "id" INTO v_id FROM "LedgerAccount" WHERE "tenantId" = p_tenant AND "key" = 'ACC:' || p_account;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT "name" INTO v_name FROM "Account" WHERE "id" = p_account AND "tenantId" = p_tenant;
  IF NOT FOUND THEN
    RETURN nexrees_ledger_account(p_tenant, 'BANK');
  END IF;
  SELECT coalesce(max("number"::int), 1200) + 1 INTO v_next
    FROM "LedgerAccount"
   WHERE "tenantId" = p_tenant AND "number" ~ '^[0-9]{4}$' AND "number"::int BETWEEN 1200 AND 1399;
  v_id := gen_random_uuid()::text;
  v_number := CASE WHEN v_next <= 1399 THEN v_next::text ELSE 'B-' || left(v_id, 8) END;
  INSERT INTO "LedgerAccount" ("id", "tenantId", "number", "name", "type", "key")
  VALUES (v_id, p_tenant, v_number, v_name, 'ASSET', 'ACC:' || p_account);
  RETURN v_id;
END $$;

-- Whole chart for a company: the default accounts plus one per bank account.
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
  PERFORM nexrees_ledger_bank_account(p_tenant, a."id")
     FROM (SELECT x."id" FROM "Account" x WHERE x."tenantId" = p_tenant AND x."type" <> 'SACHKONTO' ORDER BY x."createdAt", x."id") a;
END $$;

-- ---------- documents → entries ----------

-- Property and debtor of a charge.
CREATE OR REPLACE FUNCTION nexrees_ledger_charge_ctx(c "Charge", OUT property text, OUT lease text, OUT person text)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF c."leaseId" IS NOT NULL THEN
    lease := c."leaseId";
    SELECT b."propertyId" INTO property
      FROM "Lease" l JOIN "Unit" u ON u."id" = l."unitId" JOIN "Building" b ON b."id" = u."buildingId"
     WHERE l."id" = c."leaseId";
  ELSIF c."areaAllocationId" IS NOT NULL THEN
    SELECT a."propertyId", a."leaseId", a."personId" INTO property, lease, person
      FROM "AreaAllocation" a WHERE a."id" = c."areaAllocationId";
  END IF;
END $$;

-- Sollstellung: debtor an income account (deposit: an deposits received). A negative charge
-- (credit note) posts the other way round.
CREATE OR REPLACE FUNCTION nexrees_ledger_post_charge(c "Charge") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  ctx record;
  v_key text;
  v_label text;
  v_amount numeric(14,2) := abs(c."amount");
  v_debtor jsonb;
  v_other jsonb;
BEGIN
  IF c."amount" = 0 THEN
    RETURN;
  END IF;
  SELECT * INTO ctx FROM nexrees_ledger_charge_ctx(c);
  SELECT k, t INTO v_key, v_label FROM (VALUES
    ('MIETE', 'INCOME_RENT', 'Miete'), ('NEBENKOSTEN', 'INCOME_NK', 'Nebenkosten'), ('HAUSGELD', 'INCOME_HAUSGELD', 'Hausgeld'),
    ('KAUTION', 'DEPOSITS', 'Kaution'), ('SONSTIGES', 'INCOME_OTHER', 'Sonstiges')) AS m(ty, k, t)
   WHERE m.ty = c."type"::text;
  v_debtor := jsonb_build_object('key', 'DEBTORS', 'lease', ctx.lease, 'person', ctx.person);
  v_other := jsonb_build_object('key', v_key);
  IF c."amount" > 0 THEN
    v_debtor := v_debtor || jsonb_build_object('debit', v_amount);
    v_other := v_other || jsonb_build_object('credit', v_amount);
  ELSE
    v_debtor := v_debtor || jsonb_build_object('credit', v_amount);
    v_other := v_other || jsonb_build_object('debit', v_amount);
  END IF;
  PERFORM nexrees_ledger_post(c."tenantId", c."period"::date,
    'Sollstellung ' || v_label || ' ' || to_char(c."period", 'MM/YYYY') || coalesce(': ' || nullif(btrim(c."description"), ''), ''),
    ctx.property, 'Charge', c."id", 'BOOKING', NULL, jsonb_build_array(v_debtor, v_other));
END $$;

-- Payment: incoming = bank an debtor (matched to a charge) or an unclear receipts;
-- outgoing = debtor (refund on a charge) or unassigned expenses an bank.
CREATE OR REPLACE FUNCTION nexrees_ledger_post_payment(p "Payment") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c "Charge";
  ctx record;
  v_amount numeric(14,2) := abs(p."amount");
  v_in boolean := (p."direction" = 'EINGANG') = (p."amount" > 0);
  v_bank jsonb := jsonb_build_object('bank', p."accountId");
  v_other jsonb;
  v_property text;
BEGIN
  IF p."amount" = 0 THEN
    RETURN;
  END IF;
  IF p."chargeId" IS NOT NULL THEN
    SELECT * INTO c FROM "Charge" WHERE "id" = p."chargeId";
  END IF;
  IF c."id" IS NOT NULL THEN
    SELECT * INTO ctx FROM nexrees_ledger_charge_ctx(c);
    v_property := ctx.property;
    v_other := jsonb_build_object('key', 'DEBTORS', 'lease', ctx.lease, 'person', ctx.person);
  ELSE
    v_other := jsonb_build_object('key', CASE WHEN v_in THEN 'SUSPENSE_IN' ELSE 'SUSPENSE_OUT' END);
  END IF;
  IF v_in THEN
    v_bank := v_bank || jsonb_build_object('debit', v_amount);
    v_other := v_other || jsonb_build_object('credit', v_amount);
  ELSE
    v_bank := v_bank || jsonb_build_object('credit', v_amount);
    v_other := v_other || jsonb_build_object('debit', v_amount);
  END IF;
  PERFORM nexrees_ledger_post(p."tenantId", p."date"::date,
    CASE WHEN v_in THEN 'Zahlungseingang' ELSE 'Zahlungsausgang' END || coalesce(': ' || nullif(btrim(p."reference"), ''), ''),
    v_property, 'Payment', p."id", 'BOOKING', NULL,
    CASE WHEN v_in THEN jsonb_build_array(v_bank, v_other) ELSE jsonb_build_array(v_other, v_bank) END);
END $$;

-- Reserve movement: allocation = expense an reserve; withdrawal the other way round.
CREATE OR REPLACE FUNCTION nexrees_ledger_post_reserve(r "ReserveTransaction") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_property text;
  v_name text;
  v_amount numeric(14,2) := abs(r."amount");
BEGIN
  IF r."amount" = 0 THEN
    RETURN;
  END IF;
  SELECT "propertyId", "name" INTO v_property, v_name FROM "Reserve" WHERE "id" = r."reserveId";
  PERFORM nexrees_ledger_post(r."tenantId", r."date"::date,
    CASE WHEN r."amount" > 0 THEN 'Zuführung ' ELSE 'Entnahme ' END || coalesce(v_name, 'Rücklage') || coalesce(': ' || nullif(btrim(r."note"), ''), ''),
    v_property, 'ReserveTransaction', r."id", 'BOOKING', NULL,
    CASE WHEN r."amount" > 0
      THEN jsonb_build_array(jsonb_build_object('key', 'RESERVE_ALLOC', 'debit', v_amount), jsonb_build_object('key', 'RESERVE', 'credit', v_amount))
      ELSE jsonb_build_array(jsonb_build_object('key', 'RESERVE', 'debit', v_amount), jsonb_build_object('key', 'RESERVE_ALLOC', 'credit', v_amount))
    END);
END $$;

CREATE OR REPLACE FUNCTION nexrees_ledger_charge_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM nexrees_ledger_post_charge(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'Charge', OLD."id");
  ELSIF (NEW."amount", NEW."period", NEW."type", NEW."leaseId", NEW."areaAllocationId", NEW."description")
        IS DISTINCT FROM (OLD."amount", OLD."period", OLD."type", OLD."leaseId", OLD."areaAllocationId", OLD."description") THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'Charge', OLD."id");
    PERFORM nexrees_ledger_post_charge(NEW);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION nexrees_ledger_payment_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM nexrees_ledger_post_payment(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'Payment', OLD."id");
  ELSIF (NEW."amount", NEW."date", NEW."direction", NEW."accountId", NEW."chargeId", NEW."reference")
        IS DISTINCT FROM (OLD."amount", OLD."date", OLD."direction", OLD."accountId", OLD."chargeId", OLD."reference") THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'Payment', OLD."id");
    PERFORM nexrees_ledger_post_payment(NEW);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION nexrees_ledger_reserve_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM nexrees_ledger_post_reserve(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'ReserveTransaction', OLD."id");
  ELSIF (NEW."amount", NEW."date", NEW."reserveId") IS DISTINCT FROM (OLD."amount", OLD."date", OLD."reserveId") THEN
    PERFORM nexrees_ledger_reverse_source(OLD."tenantId", 'ReserveTransaction', OLD."id");
    PERFORM nexrees_ledger_post_reserve(NEW);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER nexrees_ledger AFTER INSERT OR UPDATE OR DELETE ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_charge_trg();
CREATE TRIGGER nexrees_ledger AFTER INSERT OR UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_payment_trg();
CREATE TRIGGER nexrees_ledger AFTER INSERT OR UPDATE OR DELETE ON "ReserveTransaction"
  FOR EACH ROW EXECUTE FUNCTION nexrees_ledger_reserve_trg();

-- ---------- existing data ----------

-- Posts every document that has no journal entry yet (data from before the ledger, and rows
-- loaded in purge mode). Entries keep the document date, also inside a closed period.
CREATE OR REPLACE FUNCTION nexrees_ledger_backfill(p_tenant text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_before int;
  v_after int;
  v_was text := coalesce(current_setting('nexrees.ledger_backfill', true), '');
BEGIN
  PERFORM set_config('nexrees.ledger_backfill', 'on', true);
  PERFORM nexrees_ledger_ensure_chart(p_tenant);
  SELECT count(*) INTO v_before FROM "JournalEntry" WHERE "tenantId" = p_tenant;

  PERFORM nexrees_ledger_post_charge(c)
     FROM (SELECT * FROM "Charge" x WHERE x."tenantId" = p_tenant
              AND NOT EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e."tenantId" = p_tenant AND e."sourceTable" = 'Charge' AND e."sourceId" = x."id")
            ORDER BY x."period", x."id") c;
  PERFORM nexrees_ledger_post_payment(p)
     FROM (SELECT * FROM "Payment" x WHERE x."tenantId" = p_tenant
              AND NOT EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e."tenantId" = p_tenant AND e."sourceTable" = 'Payment' AND e."sourceId" = x."id")
            ORDER BY x."date", x."id") p;
  PERFORM nexrees_ledger_post_reserve(r)
     FROM (SELECT * FROM "ReserveTransaction" x WHERE x."tenantId" = p_tenant
              AND NOT EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e."tenantId" = p_tenant AND e."sourceTable" = 'ReserveTransaction' AND e."sourceId" = x."id")
            ORDER BY x."date", x."id") r;

  SELECT count(*) INTO v_after FROM "JournalEntry" WHERE "tenantId" = p_tenant;
  PERFORM set_config('nexrees.ledger_backfill', v_was, true);
  RETURN v_after - v_before;
END $$;

-- Rebuilds the journal of a company from its documents. Only in purge mode: generated test
-- data is removed without Storno, so the journal is rewritten instead (prisma/scale-seed.ts).
-- Free journal entries (without a document) are posted again with their ids and dates.
CREATE OR REPLACE FUNCTION nexrees_ledger_rebuild(p_tenant text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_manual jsonb;
  m jsonb;
  v_n int;
BEGIN
  IF NOT nexrees_purging() THEN
    RAISE EXCEPTION 'NEXREES_LEDGER_IMMUTABLE: Das Journal kann nur im Bereinigungsmodus neu aufgebaut werden'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'id', e."id", 'date', e."date", 'text', e."text", 'property', e."propertyId", 'kind', e."kind", 'reverses', e."reversesId",
           'lines', (SELECT jsonb_agg(jsonb_build_object('id', l."accountId", 'debit', l."debit", 'credit', l."credit", 'lease', l."leaseId", 'person', l."personId") ORDER BY l."position")
                       FROM "JournalLine" l WHERE l."entryId" = e."id")) ORDER BY e."seq")
    INTO v_manual
    FROM "JournalEntry" e WHERE e."tenantId" = p_tenant AND e."sourceTable" IS NULL;

  DELETE FROM "JournalEntry" WHERE "tenantId" = p_tenant; -- lines cascade
  PERFORM set_config('nexrees.ledger_head', '', true);
  -- accounts of bank accounts that no longer exist and were never used again
  DELETE FROM "LedgerAccount" a
   WHERE a."tenantId" = p_tenant AND a."key" LIKE 'ACC:%'
     AND NOT EXISTS (SELECT 1 FROM "Account" b WHERE 'ACC:' || b."id" = a."key")
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_manual, '[]'::jsonb)) x, jsonb_array_elements(x->'lines') y WHERE y->>'id' = a."id");

  v_n := nexrees_ledger_backfill(p_tenant);
  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(v_manual, '[]'::jsonb)) LOOP
    PERFORM nexrees_ledger_post(p_tenant, (m->>'date')::date, m->>'text', m->>'property', NULL, NULL,
                                (m->>'kind')::"JournalKind", m->>'reverses', m->'lines', m->>'id');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Existing companies: chart of accounts and the journal of everything booked so far.
SELECT nexrees_ledger_backfill("id") FROM "Tenant";
ANALYZE "LedgerAccount";
ANALYZE "JournalEntry";
ANALYZE "JournalLine";
