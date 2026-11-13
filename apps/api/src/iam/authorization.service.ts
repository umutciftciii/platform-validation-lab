import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { decide, type Decision, type Target } from "./authorization.js";
import { inStaffContext } from "./iam-context.js";
import { loadAuthorizationSnapshot } from "./repository.js";

/**
 * Nest entry point for authorization decisions. Guards and controllers (DP-011 onwards) call
 * `authorize` on every request; there is no other way to grant access. An unknown user is denied.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(
    sessionToken: string,
    userId: string,
    permission: string,
    target: Target,
    session: { mfaVerified: boolean },
  ): Promise<Decision> {
    // DP-125: read in the database context of the presented admin session (row-level security):
    // without a live session the snapshot has no grant (deny).
    const snapshot = await inStaffContext(this.prisma, sessionToken, (tx) =>
      loadAuthorizationSnapshot(tx, userId, session),
    );
    if (!snapshot) return { allowed: false, reason: "principal_inactive" };
    return decide(snapshot, permission, target);
  }
}
