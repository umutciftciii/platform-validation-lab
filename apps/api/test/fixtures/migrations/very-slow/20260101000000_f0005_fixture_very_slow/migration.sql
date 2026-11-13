-- Test fixture: holds the advisory lock longer (~20 s) than Prisma's lock wait timeout (10 s).
CREATE TABLE "f0005_fixture" ("id" INTEGER PRIMARY KEY);
SELECT pg_sleep(20);
