/**
 * Builds the API application with its trust boundary (F1-002 Group 2; ADR-013 D2, D4, D19).
 * `main.ts` and the HTTP tests use this one function, so the tests exercise the production
 * wiring:
 *
 *  - the configuration is validated first (proxy keys, IAM secrets, TLS); anything missing or
 *    weak throws and nothing listens (NT-L4, NT-P9, NT-P13);
 *  - with DP_API_REQUIRE_TLS=true the server is HTTPS only (Node's minimum, TLS 1.2);
 *  - Nest's body parser is off: the security middleware reads at most 16 KB of JSON itself, after
 *    the proxy key and CSRF checks;
 *  - Express `trust proxy` is off and `X-Powered-By` is not sent;
 *  - every response, errors and health included, refuses to be framed (frame-protection.ts).
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { LoggerService, LogLevel } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { API_CONFIG, loadApiConfig, type ApiConfig } from "./iam/http/api-config.js";
import { frameProtection } from "./iam/http/frame-protection.js";
import { ProxyKeyMetrics } from "./iam/http/proxy-keys.js";
import { createSecurityMiddleware } from "./iam/http/security.middleware.js";

export { Clock, FaultInjector } from "./iam/http/clock.js";
export { ProxyKeyMetrics } from "./iam/http/proxy-keys.js";

export interface CreateApiAppOptions {
  logger?: false | LogLevel[] | LoggerService;
}

export async function createApiApp(
  options: CreateApiAppOptions = {},
): Promise<NestExpressApplication> {
  const preflight = loadApiConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(preflight.tls
      ? { httpsOptions: { cert: preflight.tls.cert, key: preflight.tls.key } }
      : {}),
  });
  app.set("trust proxy", false);
  app.disable("x-powered-by");
  const config = app.get<ApiConfig>(API_CONFIG);
  app.use(frameProtection);
  app.use(createSecurityMiddleware(config, app.get(ProxyKeyMetrics)));
  return app;
}
