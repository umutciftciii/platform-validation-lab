-- DP-156 (owner decision K1, DP-037): a specification value keeps the difference between a
-- specification limit and a typical value, and a limit may be one-sided or open-ended, without
-- loss. Runs as dp_owner (ADR-012A). Smallest change: columns on ProductSpecValue only.
--
--  * basis: SPECIFICATION (the default: every existing row keeps its meaning) or TYPICAL.
--    Measured results are deliberately not a basis (K2): they belong to a batch and are kept as
--    a certificate of analysis, never as a product value.
--  * A product holds at most one value per definition AND basis.
--  * RANGE: one end may be empty (">= 200" is [200, infinity)); rangeMinExclusive /
--    rangeMaxExclusive mark an open end ("< 1800", "3.80 to < 4.50"). Both default to false, so
--    existing ranges are unchanged (closed at both ends). A typical value of a RANGE definition
--    is [x, x].
--  * No data is rewritten; published snapshots stay valid (contracts default the new fields).

CREATE TYPE "SpecValueBasis" AS ENUM ('SPECIFICATION', 'TYPICAL');

ALTER TABLE "ProductSpecValue"
  ADD COLUMN "basis" "SpecValueBasis" NOT NULL DEFAULT 'SPECIFICATION',
  ADD COLUMN "rangeMinExclusive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rangeMaxExclusive" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "ProductSpecValue_productId_definitionId_key";
CREATE UNIQUE INDEX "ProductSpecValue_productId_definitionId_basis_key"
  ON "ProductSpecValue"("productId", "definitionId", "basis");

-- A range needs at least one end (one_shape already counts a range when either end is set).
ALTER TABLE "ProductSpecValue" DROP CONSTRAINT "ProductSpecValue_range_complete";
ALTER TABLE "ProductSpecValue" DROP CONSTRAINT "ProductSpecValue_range_order";
ALTER TABLE "ProductSpecValue"
  ADD CONSTRAINT "ProductSpecValue_range_order" CHECK (
    "rangeMin" IS NULL OR "rangeMax" IS NULL OR "rangeMin" <= "rangeMax"),
  -- An open end needs that end; [x, x) and (x, x] would be empty.
  ADD CONSTRAINT "ProductSpecValue_range_open_end" CHECK (
    (NOT "rangeMinExclusive" OR "rangeMin" IS NOT NULL)
    AND (NOT "rangeMaxExclusive" OR "rangeMax" IS NOT NULL)
    AND ("rangeMin" IS NULL OR "rangeMax" IS NULL OR "rangeMin" < "rangeMax"
         OR NOT ("rangeMinExclusive" OR "rangeMaxExclusive")));

-- The guard of PM-2, with the RANGE test widened to "either end"; everything else unchanged.
CREATE OR REPLACE FUNCTION catalog_spec_value_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  def "SpecDefinition"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."productId" IS DISTINCT FROM OLD."productId"
                           OR NEW."definitionId" IS DISTINCT FROM OLD."definitionId"
                           OR NEW."basis" IS DISTINCT FROM OLD."basis") THEN
    RAISE EXCEPTION 'catalog: a specification value cannot move to another product, definition or basis'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO def FROM "SpecDefinition" WHERE "id" = NEW."definitionId";
  IF (def."dataType" = 'NUMBER' AND NEW."numberValue" IS NULL)
     OR (def."dataType" = 'RANGE' AND NEW."rangeMin" IS NULL AND NEW."rangeMax" IS NULL)
     OR (def."dataType" = 'TEXT' AND NEW."textValue" IS NULL)
     OR (def."dataType" = 'BOOLEAN' AND NEW."booleanValue" IS NULL) THEN
    RAISE EXCEPTION 'catalog: the value does not match the specification data type'
      USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(def."units") = 0 AND NEW."unit" IS NOT NULL
     OR cardinality(def."units") > 0 AND (NEW."unit" IS NULL OR NOT NEW."unit" = ANY (def."units")) THEN
    RAISE EXCEPTION 'catalog: the unit is not accepted by the specification'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
