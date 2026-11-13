import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/** A Prisma client or the client of a running interactive transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
