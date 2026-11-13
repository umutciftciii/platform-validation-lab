import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Prisma connects lazily on the first query, so the API still boots (and reports
// liveness) while the database is unavailable. Readiness reports the database state.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"] ?? "" }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
