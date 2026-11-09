-- nexrees: bookkeeping integrity (GoBD) and SEPA creditor data.
--
-- 1. Period close (Festschreibung): Tenant."bookingsLockedUntil". Rows of Charge (period),
--    Payment (date), CostEntry (31 Dec of year) and ReserveTransaction (date) on or before that
--    day can no longer be inserted, changed or deleted, whatever writes them (UI, /api/v1, MCP,
--    bank sync, imports). Payment notes stay editable.
-- 2. Change journal: every UPDATE and DELETE of those tables plus Deposit and SepaMandate writes
--    an AuditLog row with the full before/after image. The acting user comes from the
--    transaction settings nexrees.user_id / nexrees.user_name / nexrees.source when the app
--    sets them (src/server/ledger.ts); otherwise source = 'db'.
-- 3. AuditLog is append-only.
-- Escape hatch for deleting a whole company (offboarding, retention purge): the transaction sets
-- nexrees.purge = 'on' (src/server/actions/tenants.ts).

ALTER TABLE "Tenant" ADD COLUMN "bookingsLockedUntil" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "sepaCreditorId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "sepaCreditorIban" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "sepaCreditorBic" TEXT;
ALTER TABLE "SepaMandate" ADD COLUMN "lastCollectedAt" TIMESTAMP(3);
ALTER TABLE "AuditLog" ADD COLUMN "before" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN "after" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN "source" TEXT;
CREATE INDEX "AuditLog_tenantId_entity_entityId_idx" ON "AuditLog"("tenantId", "entity", "entityId");

CREATE OR REPLACE FUNCTION nexrees_purging() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('nexrees.purge', true), '') = 'on'
$$;

-- AuditLog: append-only
CREATE OR REPLACE FUNCTION nexrees_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'NEXREES_AUDIT_IMMUTABLE: Audit-Log-Einträge können nicht geändert oder gelöscht werden'
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER nexrees_audit_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION nexrees_audit_append_only();

-- Booking date of a row, per table.
CREATE OR REPLACE FUNCTION nexrees_booking_date(tbl text, r jsonb) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tbl
    WHEN 'Charge' THEN (r->>'period')::timestamp::date
    WHEN 'Payment' THEN (r->>'date')::timestamp::date
    WHEN 'ReserveTransaction' THEN (r->>'date')::timestamp::date
    WHEN 'CostEntry' THEN make_date((r->>'year')::int, 12, 31)
  END
$$;

CREATE OR REPLACE FUNCTION nexrees_period_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked date;
  rec jsonb;
  d date;
  editable text[] := TG_ARGV; -- columns that may change on locked rows
BEGIN
  IF nexrees_purging() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  SELECT "bookingsLockedUntil"::date INTO locked FROM "Tenant" WHERE id = rec->>'tenantId';
  IF locked IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- only editable columns changed: allowed
    IF (to_jsonb(OLD) - editable) = (to_jsonb(NEW) - editable) THEN
      RETURN NEW;
    END IF;
    d := least(nexrees_booking_date(TG_TABLE_NAME, to_jsonb(OLD)), nexrees_booking_date(TG_TABLE_NAME, to_jsonb(NEW)));
  ELSE
    d := nexrees_booking_date(TG_TABLE_NAME, rec);
  END IF;

  IF d IS NOT NULL AND d <= locked THEN
    RAISE EXCEPTION 'NEXREES_PERIOD_LOCKED: % vom % liegt im festgeschriebenen Zeitraum (bis %)',
      TG_TABLE_NAME, to_char(d, 'DD.MM.YYYY'), to_char(locked, 'DD.MM.YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER nexrees_period_lock BEFORE INSERT OR UPDATE OR DELETE ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION nexrees_period_lock();
CREATE TRIGGER nexrees_period_lock BEFORE INSERT OR UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION nexrees_period_lock('note');
CREATE TRIGGER nexrees_period_lock BEFORE INSERT OR UPDATE OR DELETE ON "CostEntry"
  FOR EACH ROW EXECUTE FUNCTION nexrees_period_lock('note');
CREATE TRIGGER nexrees_period_lock BEFORE INSERT OR UPDATE OR DELETE ON "ReserveTransaction"
  FOR EACH ROW EXECUTE FUNCTION nexrees_period_lock('note');

-- Change journal with before/after image.
CREATE OR REPLACE FUNCTION nexrees_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  IF nexrees_purging() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  INSERT INTO "AuditLog" (id, "tenantId", "userId", "userName", action, entity, "entityId", summary, "before", "after", source)
  VALUES (
    gen_random_uuid()::text,
    rec->>'tenantId',
    nullif(current_setting('nexrees.user_id', true), ''),
    nullif(current_setting('nexrees.user_name', true), ''),
    (CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END)::"AuditAction",
    TG_TABLE_NAME,
    rec->>'id',
    'Journal',
    to_jsonb(OLD),
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    coalesce(nullif(current_setting('nexrees.source', true), ''), 'db')
  );
  RETURN NULL;
END $$;

CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "Charge" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();
CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();
CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "CostEntry" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();
CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "ReserveTransaction" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();
CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "Deposit" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();
CREATE TRIGGER nexrees_journal AFTER UPDATE OR DELETE ON "SepaMandate" FOR EACH ROW EXECUTE FUNCTION nexrees_journal();

-- The period close only moves forward (a closed period is never reopened).
CREATE OR REPLACE FUNCTION nexrees_lock_forward_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF nexrees_purging() THEN
    RETURN NEW;
  END IF;
  IF OLD."bookingsLockedUntil" IS NOT NULL
     AND (NEW."bookingsLockedUntil" IS NULL OR NEW."bookingsLockedUntil" < OLD."bookingsLockedUntil") THEN
    RAISE EXCEPTION 'NEXREES_LOCK_BACKWARDS: Ein festgeschriebener Zeitraum kann nicht wieder geöffnet werden (bis %)',
      to_char(OLD."bookingsLockedUntil", 'DD.MM.YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER nexrees_lock_forward_only
  BEFORE UPDATE OF "bookingsLockedUntil" ON "Tenant"
  FOR EACH ROW EXECUTE FUNCTION nexrees_lock_forward_only();
