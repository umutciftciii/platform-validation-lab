-- Test fixture: holds Prisma's migration advisory lock for ~6 s so a second runner must wait.
CREATE TABLE "f0005_fixture" ("id" INTEGER PRIMARY KEY);
SELECT pg_sleep(6);
