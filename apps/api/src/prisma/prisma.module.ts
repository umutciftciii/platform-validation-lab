import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

// One PrismaClient for the whole API.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
