import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { healthResponse, type HealthResponse } from "@dream/contracts";
import { ProxyKeyMetrics } from "../iam/http/proxy-keys.js";
import { ImageProcessingGate } from "../media/image-gate.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APP_VERSION } from "../version.js";
import { evaluateDatabase } from "./database-check.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ProxyKeyMetrics) private readonly proxyMetrics: ProxyKeyMetrics,
    @Inject(ImageProcessingGate) private readonly imageGate: ImageProcessingGate,
  ) {}

  /**
   * Proxy-key counters (F1-002, design 2.3): rejected keys and accepted requests per app and slot
   * (current/next). Counts only, never a key; the rotation runbook reads it to see that the old
   * slot is no longer used. Reachable only on the private network, like every /health route.
   * PM-3: image processing (uploads run, waiting, refused as busy; memory growth and peak).
   */
  @Get("metrics")
  metrics() {
    return { proxyKeys: this.proxyMetrics.snapshot(), imageProcessing: this.imageGate.snapshot() };
  }

  /** Liveness: the process is up. Does not touch the database. */
  @Get()
  live(): HealthResponse {
    return healthResponse("api", APP_VERSION);
  }

  /**
   * Readiness: the database answers, is the one this mode expects, and the API is connected with
   * a least-privileged role (ADR-012A). Returns 503 otherwise.
   */
  @Get("ready")
  async ready(): Promise<HealthResponse> {
    // DB_ENV / DB_EXPECTED_NAME are set per mode by Compose (ADR-009). An API connected to
    // another mode's database reports 503 instead of serving it. An API connected as a superuser,
    // a table owner or a role that can create in schema public reports 503 as well: it would hold
    // the power to disable the guard triggers and rewrite the audit trail.
    let actual: string | undefined;
    let privileged: boolean | undefined;
    let reachable = true;
    try {
      const rows = await this.prisma.$queryRaw<{ db: string; privileged: boolean }[]>`
        SELECT current_database() AS db,
          coalesce((SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), true)
          OR has_schema_privilege('public', 'CREATE')
          OR EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user
          ) AS privileged`;
      actual = rows[0]?.db;
      privileged = rows[0]?.privileged ?? true;
    } catch {
      reachable = false;
    }
    const database = evaluateDatabase({
      env: process.env["DB_ENV"] ?? "unset",
      expected: process.env["DB_EXPECTED_NAME"],
      actual,
      reachable,
      privileged,
    });
    const body = healthResponse("api", APP_VERSION, { database });
    if (body.status !== "ok") throw new ServiceUnavailableException(body);
    return body;
  }
}
