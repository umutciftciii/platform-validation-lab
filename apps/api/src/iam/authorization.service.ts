import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { decide, type Decision, type Target } from "./authorization.js";
import { loadAuthorizationSnapshot } from "./repository.js";

/**
 * Nest entry point for authorization decisions. Guards and controllers (DP-011 onwards) call
 * `authorize` on every request; there is no other way to grant access. An unknown user is denied.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(
    userId: string,
    permission: string,
    target: Target,
    session: { mfaVerified: boolean },
  ): Promise<Decision> {
    const snapshot = await loadAuthorizationSnapshot(this.prisma, userId, session);
    if (!snapshot) return { allowed: false, reason: "principal_inactive" };
    return decide(snapshot, permission, target);
  }
}
