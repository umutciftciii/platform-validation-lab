-- PM-3 (DP-068), step 1 of 2: the review states of a product master.
--
-- Runs as dp_owner (ADR-012A). Additive only: two values are added to the ProductStatus enum;
-- no row changes. They are added in a migration of their own because PostgreSQL does not let
-- the same transaction use a new enum value, and the next migration's CHECK constraints do.

ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW' BEFORE 'ARCHIVED';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'APPROVED' BEFORE 'ARCHIVED';
