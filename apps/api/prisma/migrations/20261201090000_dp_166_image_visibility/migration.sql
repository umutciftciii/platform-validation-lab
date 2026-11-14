-- DP-166: a product image can be hidden from visitors without deleting it. Runs as dp_owner
-- (ADR-012A). Smallest change: one column and one rule on ProductImage.
--
--  * isPublic defaults to true, so every existing image keeps its current behaviour.
--  * A hidden image stays in the admin (list, file, alt text) and is left out of the next
--    publication snapshot and its imageIds; existing snapshots are frozen and do not change.
--  * The cover is always public: hide another image or choose a public cover first.
--  * Showing it again is the rollback; nothing is deleted.
--  * The file facts stay immutable (catalog_image_immutable is unchanged): isPublic, like
--    isCover, is an editable presentation field.

ALTER TABLE "ProductImage" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_cover_public" CHECK (NOT "isCover" OR "isPublic");
