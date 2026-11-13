/**
 * Opaque, database-backed staff sessions (F1-002 Group 2; ADR-013 D1, D3, D8; design 5).
 *
 * - The session id is 256 random bits in `__Host-dp_admin_session`; only its SHA-256 is stored.
 *   Ids are generated on the server after the second factor only, so fixation is impossible.
 * - Every request: cookie -> hash -> Session; not revoked, within idle (30 min) and absolute (8 h)
 *   time, same `securityVersion` as the user, user ACTIVE staff, app ADMIN (design 5.2). Any
 *   failure: 401 AUTH_SESSION_REQUIRED and the cookie is cleared.
 * - `lastSeenAt` is written at most once a minute; the idle expiry slides, never past the
 *   absolute expiry.
 * - Rotation (MFA login, step-up, own password change): a new row and cookie, the old row
 *   ROTATED. A rotated session keeps the absolute expiry of the original.
 * - At most five live sessions per user; opening a sixth revokes the oldest (LIMIT_EXCEEDED).
 */
import { Inject, Injectable } from "@nestjs/common";
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import type { SessionRevokeReason } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import type { Db } from "../db.js";
import { ApiError } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import { SESSION_POLICIES } from "../session-policy.js";

const POLICY = SESSION_POLICIES.STAFF;
const MINUTE = 60_000;
export const TOUCH_INTERVAL_MS = 60_000;

export interface ActiveSession {
  id: string;
  userId: string;
  securityVersion: number;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  mfaVerifiedAt: Date | null;
  user: {
    id: string;
    email: string;
    emailNormalized: string;
    displayName: string | null;
    passwordHash: string | null;
    securityVersion: number;
  };
}

export function stepUpValidUntil(mfaVerifiedAt: Date | null): Date | null {
  if (!mfaVerifiedAt || POLICY.stepUpMaxAgeMinutes === null) return null;
  return new Date(mfaVerifiedAt.getTime() + POLICY.stepUpMaxAgeMinutes * MINUTE);
}

/** The session passed a second factor no longer than `stepUpMaxAgeMinutes` ago (D8). */
export function isStepUpFresh(mfaVerifiedAt: Date | null, now: Date): boolean {
  const until = stepUpValidUntil(mfaVerifiedAt);
  return until !== null && now.getTime() <= until.getTime() && mfaVerifiedAt! <= now;
}

const sessionRequired = () => new ApiError("AUTH_SESSION_REQUIRED", [], {}, [ADMIN_SESSION_COOKIE]);

@Injectable()
export class StaffSessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Live sessions of a user (not revoked, not expired), oldest first. */
  liveWhere(userId: string, now: Date) {
    return {
      userId,
      revokedAt: null,
      idleExpiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    };
  }

  /**
   * Opens a session. `rotatedFrom` keeps the original absolute expiry and records the chain; the
   * caller revokes the old row in the same transaction.
   */
  async open(
    db: Db,
    input: {
      userId: string;
      securityVersion: number;
      mfaVerifiedAt: Date | null;
      ctx: RequestContext;
      now: Date;
      rotatedFrom?: { id: string; absoluteExpiresAt: Date };
    },
  ): Promise<string> {
    const { now } = input;
    const live = await db.session.findMany({
      where: this.liveWhere(input.userId, now),
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const excess = live.length - (POLICY.maxConcurrentSessions - 1);
    if (excess > 0) {
      await db.session.updateMany({
        where: { id: { in: live.slice(0, excess).map((s) => s.id) }, revokedAt: null },
        data: { revokedAt: now, revokedReason: "LIMIT_EXCEEDED" },
      });
    }
    const absolute =
      input.rotatedFrom?.absoluteExpiresAt ??
      new Date(now.getTime() + POLICY.absoluteTimeoutMinutes * MINUTE);
    const idle = new Date(
      Math.min(now.getTime() + POLICY.idleTimeoutMinutes * MINUTE, absolute.getTime()),
    );
    const token = generateToken();
    await db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: input.userId,
        kind: "STAFF",
        app: "ADMIN",
        siteId: null,
        securityVersion: input.securityVersion,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt: idle,
        absoluteExpiresAt: absolute,
        mfaVerifiedAt: input.mfaVerifiedAt,
        persistent: false,
        rotatedFromId: input.rotatedFrom?.id ?? null,
        ipPrefix: input.ctx.ipPrefix,
        userAgent: input.ctx.userAgent,
      },
    });
    return token;
  }

  /** Resolves the session cookie or throws 401 AUTH_SESSION_REQUIRED (clearing the cookie). */
  async require(ctx: RequestContext): Promise<ActiveSession> {
    const session = await this.find(ctx);
    if (!session) throw sessionRequired();
    return session;
  }

  /** The valid session of this request, or null. Touches `lastSeenAt` at most once a minute. */
  async find(ctx: RequestContext): Promise<ActiveSession | null> {
    if (ctx.app !== "ADMIN") return null;
    const raw = ctx.cookies.get(ADMIN_SESSION_COOKIE);
    if (!raw || !isWellFormedToken(raw)) return null;
    const now = this.clock.now();
    const row = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      select: {
        id: true,
        userId: true,
        kind: true,
        app: true,
        securityVersion: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        mfaVerifiedAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            emailNormalized: true,
            displayName: true,
            kind: true,
            status: true,
            passwordHash: true,
            securityVersion: true,
          },
        },
      },
    });
    if (
      !row ||
      row.revokedAt !== null ||
      row.kind !== "STAFF" ||
      row.app !== "ADMIN" ||
      row.idleExpiresAt.getTime() <= now.getTime() ||
      row.absoluteExpiresAt.getTime() <= now.getTime() ||
      row.securityVersion !== row.user.securityVersion ||
      row.user.kind !== "STAFF" ||
      row.user.status !== "ACTIVE"
    ) {
      return null;
    }
    let { lastSeenAt, idleExpiresAt } = row;
    if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      idleExpiresAt = new Date(
        Math.min(
          now.getTime() + POLICY.idleTimeoutMinutes * MINUTE,
          row.absoluteExpiresAt.getTime(),
        ),
      );
      lastSeenAt = now;
      await this.prisma.session.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { lastSeenAt, idleExpiresAt },
      });
    }
    return {
      id: row.id,
      userId: row.userId,
      securityVersion: row.securityVersion,
      createdAt: row.createdAt,
      lastSeenAt,
      idleExpiresAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      mfaVerifiedAt: row.mfaVerifiedAt,
      user: row.user,
    };
  }

  /** Revokes one session if it is still live; returns whether this call revoked it. */
  async revoke(db: Db, id: string, reason: SessionRevokeReason, now: Date): Promise<boolean> {
    const { count } = await db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return count === 1;
  }

  /** Revokes every unrevoked session of a user (optionally except one); returns the count. */
  async revokeAll(
    db: Db,
    userId: string,
    reason: SessionRevokeReason,
    now: Date,
    exceptId?: string,
  ): Promise<number> {
    const { count } = await db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { revokedAt: now, revokedReason: reason },
    });
    return count;
  }

  /** The presented session row (any state), for logout and rotation of a stale cookie. */
  async presented(ctx: RequestContext): Promise<{ id: string; userId: string } | null> {
    const raw = ctx.cookies.get(ADMIN_SESSION_COOKIE);
    if (!raw || !isWellFormedToken(raw)) return null;
    return this.prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      select: { id: true, userId: true },
    });
  }
}
