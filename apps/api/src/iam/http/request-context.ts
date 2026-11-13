/**
 * What the security middleware established about a request (design 2.5, 5.2). Controllers read
 * it through `@Ctx()`; nothing downstream looks at raw headers again. In particular `Host`,
 * `X-Forwarded-*` and `Forwarded` are never read (AC-PX-5): the client IP comes only from the
 * authenticated proxy's `X-DP-Client-IP`.
 */
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthAppValue, KeySlot } from "./proxy-keys.js";

export interface RequestContext {
  app: AuthAppValue;
  slot: KeySlot;
  requestId: string;
  /** From X-DP-Client-IP of the authenticated proxy; null when absent or not an IP address. */
  clientIp: string | null;
  /** IPv4 /24 or IPv6 /48 of clientIp: throttle keys and Session.ipPrefix. */
  ipPrefix: string | null;
  userAgent: string | null;
  /** Only the cookies of this app (admin: session and challenge). */
  cookies: ReadonlyMap<string, string>;
}

export interface RequestWithContext {
  dp?: RequestContext;
  body?: unknown;
}

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithContext>();
  if (!req.dp) throw new Error("request context missing: security middleware not installed");
  return req.dp;
});
