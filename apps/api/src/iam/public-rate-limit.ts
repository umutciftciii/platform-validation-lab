/**
 * Fixed-window rate limits of the public routes (DP-042; ADR-016 D7, R-18).
 *
 * Each bucket is one row of "PublicRateLimit" keyed by an HMAC (IAM_HMAC_KEY, domain
 * `public_rate`) of its name and subject, so the table holds no e-mail address or IP. A request
 * takes one unit from every bucket it names with one atomic upsert per bucket; when any bucket is
 * over its limit the request is refused with 429 RATE_LIMITED and Retry-After, before the caller
 * writes anything. Expired buckets are deleted at most every ten minutes per process.
 *
 * Without a client IP (the site's server sent no X-DP-Client-IP) every such request shares one
 * bucket: strict on purpose, production sets DP_TRUSTED_PROXY_HOPS on the sites (ADR-013).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { hmacHex } from "./auth/hmac.js";
import { API_CONFIG, type ApiConfig } from "./http/api-config.js";
import { ApiError } from "./http/api-error.js";
import { Clock } from "./http/clock.js";
import type { RequestContext } from "./http/request-context.js";

export interface RateBucket {
  /** Stable bucket name (part of the key), e.g. "lead_request_ip". */
  name: string;
  /** What is counted (IP prefix, site id + e-mail, …); hashed, never stored. */
  subject: string;
  limit: number;
  windowSec: number;
}

/** ADR-016 D7. */
export const PUBLIC_RATE_LIMITS = {
  leadRequestPerIp: { limit: 10, windowSec: 3600 },
  leadRequestPerEmail: { limit: 5, windowSec: 3600 },
  leadRequestPerSite: { limit: 300, windowSec: 3600 },
  documentDownloadPerIp: { limit: 120, windowSec: 600 },
} as const;

const NO_IP = "(no client ip)";
const PURGE_EVERY_MS = 10 * 60 * 1000;

/** The client's IP prefix as a bucket subject (all requests without one share a bucket). */
export function ipSubject(ctx: RequestContext): string {
  return ctx.ipPrefix ?? NO_IP;
}

interface Row {
  count: number;
  expiresAt: Date;
}

@Injectable()
export class PublicRateLimitService {
  private readonly log = new Logger("PublicRateLimit");
  private lastPurge = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** HMAC of the client's IP prefix for evidence rows (ADR-016 D3); null without one. */
  ipPrefixDigest(ctx: RequestContext): string | null {
    return ctx.ipPrefix
      ? hmacHex(this.config.secrets.hmacKey, "lead_ip_prefix", ctx.ipPrefix)
      : null;
  }

  key(bucket: Pick<RateBucket, "name" | "subject">): string {
    return hmacHex(this.config.secrets.hmacKey, "public_rate", `${bucket.name}\0${bucket.subject}`);
  }

  /** Takes one unit from every bucket; 429 RATE_LIMITED with Retry-After when one is exhausted. */
  async consume(buckets: readonly RateBucket[]): Promise<void> {
    const now = this.clock.now();
    let retryAfter = 0;
    for (const b of buckets) {
      const key = this.key(b);
      const fresh = new Date(now.getTime() + b.windowSec * 1000);
      const rows = await this.prisma.$queryRaw<Row[]>`
        INSERT INTO "PublicRateLimit" ("key", "windowStartedAt", "count", "expiresAt")
        VALUES (${key}, ${now}, 1, ${fresh})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "PublicRateLimit"."expiresAt" <= ${now} THEN 1
                         ELSE "PublicRateLimit"."count" + 1 END,
          "windowStartedAt" = CASE WHEN "PublicRateLimit"."expiresAt" <= ${now} THEN ${now}
                                   ELSE "PublicRateLimit"."windowStartedAt" END,
          "expiresAt" = CASE WHEN "PublicRateLimit"."expiresAt" <= ${now} THEN ${fresh}
                             ELSE "PublicRateLimit"."expiresAt" END
        RETURNING "count", "expiresAt"`;
      const row = rows[0];
      if (row && row.count > b.limit) {
        const wait = Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000);
        retryAfter = Math.max(retryAfter, wait, 1);
      }
    }
    this.purgeSometimes(now);
    if (retryAfter > 0) {
      throw new ApiError("RATE_LIMITED", [], { "Retry-After": String(retryAfter) });
    }
  }

  private purgeSometimes(now: Date): void {
    if (now.getTime() - this.lastPurge < PURGE_EVERY_MS) return;
    this.lastPurge = now.getTime();
    this.prisma.publicRateLimit
      .deleteMany({ where: { expiresAt: { lt: now } } })
      .catch(() => this.log.warn("expired rate-limit buckets could not be deleted"));
  }
}
