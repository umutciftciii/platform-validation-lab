/**
 * Outgoing e-mail of the API (DP-221, ADR-026 D5). The first user is the staff notification of a
 * new contact-form message (DP-046 builds on this).
 *
 * `DP_MAIL_TRANSPORT` chooses where mail goes:
 *  - `off` (default): nothing is sent; every notification is recorded as SKIPPED.
 *  - `capture`: the whole path runs, but the message goes to an in-process sink that keeps the
 *    last few messages in memory and never leaves the process (local, DEV, tests).
 *  - `smtp`: the configured mail server. Refused while `DP_DEPLOY_ENV=local`, so no local stack
 *    (and no DEV) can ever send real e-mail (owner rule, DP-221 brief).
 *
 * Nothing here logs addresses, subjects or bodies; a failure is reduced to a fixed reason code
 * (`smtp_*`), never the mail server's reply text (which can echo addresses).
 */
import { createTransport, type Transporter } from "nodemailer";
import type { MailTransport } from "@dream/contracts";
import { ApiConfigError, type DeployEnv } from "../iam/http/api-config.js";

export const MAIL_SENDER = "DP_MAIL_SENDER";

export interface MailMessage {
  to: readonly string[];
  subject: string;
  text: string;
}

/** A delivery failure reduced to a code. `permanent`: retrying will not help. */
export class MailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(`mail delivery failed: ${code}`);
    this.name = "MailDeliveryError";
  }
}

export interface MailSender {
  readonly transport: MailTransport;
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** `tls`: TLS from the first byte (465); `starttls`: plain connect, STARTTLS required. */
  security: "tls" | "starttls";
  user: string | null;
  password: string | null;
}

export interface MailConfig {
  transport: MailTransport;
  from: string;
  smtp: SmtpConfig | null;
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+$/;
const FROM = /^(?:[^<>"\r\n]{1,80} <[^\s@<>"]+@[^\s@<>"]+>|[^\s@<>"]+@[^\s@<>"]+)$/;

export function loadMailConfig(
  env: NodeJS.ProcessEnv = process.env,
  deployEnv: DeployEnv = "local",
): MailConfig {
  const raw = (env["DP_MAIL_TRANSPORT"] ?? "off").trim().toLowerCase() || "off";
  if (raw !== "off" && raw !== "capture" && raw !== "smtp") {
    throw new ApiConfigError(`DP_MAIL_TRANSPORT must be off, capture or smtp (got "${raw}")`);
  }
  const from = (env["DP_MAIL_FROM"] ?? "").trim() || "Dream Petroleum <no-reply@localhost.invalid>";
  if (!FROM.test(from)) throw new ApiConfigError("DP_MAIL_FROM is not a valid sender address");
  if (raw !== "smtp") return { transport: raw, from, smtp: null };

  if (deployEnv === "local") {
    throw new ApiConfigError(
      "DP_MAIL_TRANSPORT=smtp is refused when DP_DEPLOY_ENV=local: local stacks and DEV never send real e-mail (DP-221); use capture",
    );
  }
  if (!(env["DP_MAIL_FROM"] ?? "").trim()) {
    throw new ApiConfigError("DP_MAIL_FROM is required with DP_MAIL_TRANSPORT=smtp");
  }
  const host = (env["DP_SMTP_HOST"] ?? "").trim();
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) {
    throw new ApiConfigError("DP_SMTP_HOST is required with DP_MAIL_TRANSPORT=smtp");
  }
  const security = (env["DP_SMTP_SECURITY"] ?? "starttls").trim().toLowerCase();
  if (security !== "tls" && security !== "starttls") {
    throw new ApiConfigError("DP_SMTP_SECURITY must be tls or starttls (plain SMTP is refused)");
  }
  const port = Number((env["DP_SMTP_PORT"] ?? "").trim() || (security === "tls" ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiConfigError("DP_SMTP_PORT must be a port number");
  }
  const user = (env["DP_SMTP_USER"] ?? "").trim() || null;
  const password = env["DP_SMTP_PASSWORD"] ?? null;
  if ((user === null) !== (password === null || password === "")) {
    throw new ApiConfigError("DP_SMTP_USER and DP_SMTP_PASSWORD are set together or not at all");
  }
  return {
    transport: "smtp",
    from,
    smtp: { host, port, security, user, password: user ? password : null },
  };
}

/** Sends nothing; the caller records the notification as SKIPPED (`transport_off`). */
export class OffMailSender implements MailSender {
  readonly transport = "off" as const;
  send(): Promise<void> {
    return Promise.reject(new MailDeliveryError("transport_off", true));
  }
}

/** Keeps the last messages in memory; nothing leaves the process (local, DEV, tests). */
export class CaptureMailSender implements MailSender {
  readonly transport = "capture" as const;
  static readonly KEEP = 50;
  private readonly messages: MailMessage[] = [];
  /** Test hook: the next sends fail with these errors, in order. */
  readonly failNext: MailDeliveryError[] = [];

  send(message: MailMessage): Promise<void> {
    const failure = this.failNext.shift();
    if (failure) return Promise.reject(failure);
    for (const to of message.to) {
      if (!ADDRESS.test(to)) return Promise.reject(new MailDeliveryError("smtp_rejected", true));
    }
    this.messages.push({ to: [...message.to], subject: message.subject, text: message.text });
    if (this.messages.length > CaptureMailSender.KEEP) this.messages.shift();
    return Promise.resolve();
  }

  captured(): readonly MailMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
    this.failNext.length = 0;
  }
}

/** nodemailer error → reason code. 5xx and authentication problems are permanent. */
export function smtpFailure(error: unknown): MailDeliveryError {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const response = typeof e.responseCode === "number" ? e.responseCode : 0;
  if (code === "EAUTH") return new MailDeliveryError("smtp_auth", true);
  if (response >= 500) return new MailDeliveryError("smtp_rejected", true);
  if (response >= 400) return new MailDeliveryError("smtp_deferred", false);
  if (code === "ETIMEDOUT" || (code === "ESOCKET" && /timeout/i.test(String(error)))) {
    return new MailDeliveryError("smtp_timeout", false);
  }
  if (code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS") {
    return new MailDeliveryError("smtp_unavailable", false);
  }
  if (code === "EENVELOPE") return new MailDeliveryError("smtp_rejected", true);
  return new MailDeliveryError("smtp_error", false);
}

export class SmtpMailSender implements MailSender {
  readonly transport = "smtp" as const;
  private readonly transporter: Transporter;

  constructor(
    smtp: SmtpConfig,
    private readonly from: string,
  ) {
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.security === "tls",
      requireTLS: smtp.security === "starttls",
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: [...message.to],
        subject: message.subject,
        text: message.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch (error) {
      throw smtpFailure(error);
    }
  }

  close(): void {
    this.transporter.close();
  }
}

export function createMailSender(config: MailConfig): MailSender {
  if (config.transport === "capture") return new CaptureMailSender();
  if (config.transport === "smtp" && config.smtp)
    return new SmtpMailSender(config.smtp, config.from);
  return new OffMailSender();
}
