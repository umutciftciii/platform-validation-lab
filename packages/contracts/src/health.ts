/** Service names used by health endpoints and the smoke test. */
export const SERVICE_NAMES = ["web-bv", "web-corporate", "admin", "api"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthCheck {
  status: HealthStatus;
  detail?: string;
}

/** Response body of every `/health` (API) and `/api/health` (Next.js) endpoint. */
export interface HealthResponse {
  service: ServiceName;
  status: HealthStatus;
  version: string;
  time: string;
  checks?: Record<string, HealthCheck>;
}

export function healthResponse(
  service: ServiceName,
  version: string,
  checks?: Record<string, HealthCheck>,
): HealthResponse {
  const values = Object.values(checks ?? {});
  const status: HealthStatus = values.some((c) => c.status === "down")
    ? "down"
    : values.some((c) => c.status === "degraded")
      ? "degraded"
      : "ok";
  return {
    service,
    status,
    version,
    time: new Date().toISOString(),
    ...(checks ? { checks } : {}),
  };
}
