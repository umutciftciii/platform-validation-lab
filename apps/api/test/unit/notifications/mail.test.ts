// DP-221 (ADR-026 D5, D6): outgoing e-mail configuration, failure codes and the notification text.
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ApiConfigError } from "../../../src/iam/http/api-config.js";
import {
  CaptureMailSender,
  MailDeliveryError,
  OffMailSender,
  SmtpMailSender,
  createMailSender,
  type MailSender,
  loadMailConfig,
  smtpFailure,
} from "../../../src/notifications/mail.js";
import { notificationMail } from "../../../src/leads/lead-notification-sender.service.js";

describe("DP-221 mail configuration", () => {
  it("is off unless configured, and capture keeps everything in the process", () => {
    expect(loadMailConfig({}, "local")).toMatchObject({ transport: "off", smtp: null });
    expect(loadMailConfig({ DP_MAIL_TRANSPORT: "capture" }, "local").transport).toBe("capture");
    expect(createMailSender(loadMailConfig({}, "local"))).toBeInstanceOf(OffMailSender);
    expect(
      createMailSender(loadMailConfig({ DP_MAIL_TRANSPORT: "capture" }, "local")),
    ).toBeInstanceOf(CaptureMailSender);
  });

  it("refuses smtp on a local stack (DEV never sends real e-mail)", () => {
    expect(() =>
      loadMailConfig(
        {
          DP_MAIL_TRANSPORT: "smtp",
          DP_MAIL_FROM: "Dream Petroleum <no-reply@example.com>",
          DP_SMTP_HOST: "smtp.example.com",
        },
        "local",
      ),
    ).toThrow(/refused when DP_DEPLOY_ENV=local/);
  });

  it("needs a sender, a host and TLS for smtp; user and password go together", () => {
    const base = {
      DP_MAIL_TRANSPORT: "smtp",
      DP_MAIL_FROM: "Dream Petroleum <no-reply@example.com>",
      DP_SMTP_HOST: "smtp.example.com",
    };
    expect(loadMailConfig(base, "production").smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      user: null,
      password: null,
    });
    expect(loadMailConfig({ ...base, DP_SMTP_SECURITY: "tls" }, "staging").smtp?.port).toBe(465);
    expect(() => loadMailConfig({ ...base, DP_MAIL_FROM: "" }, "production")).toThrow(
      ApiConfigError,
    );
    expect(() => loadMailConfig({ ...base, DP_SMTP_HOST: "" }, "production")).toThrow(
      /DP_SMTP_HOST/,
    );
    expect(() => loadMailConfig({ ...base, DP_SMTP_SECURITY: "none" }, "production")).toThrow(
      /plain SMTP is refused/,
    );
    expect(() => loadMailConfig({ ...base, DP_SMTP_USER: "mailer" }, "production")).toThrow(
      /set together/,
    );
    expect(() => loadMailConfig({ ...base, DP_SMTP_PORT: "70000" }, "production")).toThrow(/port/);
    expect(() => loadMailConfig({ DP_MAIL_TRANSPORT: "sendmail" }, "local")).toThrow(
      /off, capture or smtp/,
    );
    expect(() =>
      loadMailConfig({ DP_MAIL_TRANSPORT: "capture", DP_MAIL_FROM: "bad\r\nBcc: x@y.z" }, "local"),
    ).toThrow(/DP_MAIL_FROM/);
  });
});

describe("DP-221 mail senders", () => {
  it("off never sends; capture keeps a bounded copy and can be made to fail", async () => {
    await expect(
      (new OffMailSender() as MailSender).send({ to: ["a@b.c"], subject: "s", text: "t" }),
    ).rejects.toThrow(MailDeliveryError);
    const capture = new CaptureMailSender();
    for (let i = 0; i < CaptureMailSender.KEEP + 5; i++) {
      await capture.send({ to: ["a@b.c"], subject: `s${i}`, text: "t" });
    }
    expect(capture.captured()).toHaveLength(CaptureMailSender.KEEP);
    expect(capture.captured().at(-1)?.subject).toBe(`s${CaptureMailSender.KEEP + 4}`);
    capture.failNext.push(new MailDeliveryError("smtp_unavailable", false));
    await expect(capture.send({ to: ["a@b.c"], subject: "x", text: "t" })).rejects.toMatchObject({
      code: "smtp_unavailable",
      permanent: false,
    });
    await expect(
      capture.send({ to: ["not an address"], subject: "x", text: "t" }),
    ).rejects.toMatchObject({ code: "smtp_rejected" });
  });

  it("maps mail server errors to codes, never to the server's text", () => {
    expect(smtpFailure({ code: "EAUTH", response: "535 user x@y.z" })).toMatchObject({
      code: "smtp_auth",
      permanent: true,
    });
    expect(smtpFailure({ responseCode: 550, response: "550 x@y.z unknown" })).toMatchObject({
      code: "smtp_rejected",
      permanent: true,
    });
    expect(smtpFailure({ responseCode: 451 })).toMatchObject({
      code: "smtp_deferred",
      permanent: false,
    });
    expect(smtpFailure({ code: "ETIMEDOUT" })).toMatchObject({
      code: "smtp_timeout",
      permanent: false,
    });
    expect(smtpFailure({ code: "ECONNECTION" })).toMatchObject({
      code: "smtp_unavailable",
      permanent: false,
    });
    expect(smtpFailure(new Error("x@y.z"))).toMatchObject({ code: "smtp_error", permanent: false });
    expect(smtpFailure({ responseCode: 550 }).message).not.toMatch(/@/);
  });
});

describe("DP-221 SMTP sender against a local fake server (no network beyond 127.0.0.1)", () => {
  let server: Server | undefined;
  const seen: string[] = [];
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function fake(greeting: string): Promise<number> {
    server = createServer((socket: Socket) => {
      socket.write(`${greeting}\r\n`);
      socket.on("data", (chunk) => {
        const line = chunk.toString("utf8").trim().toUpperCase();
        seen.push(line);
        if (line.startsWith("QUIT")) socket.end("221 bye\r\n");
        else if (line.startsWith("EHLO")) socket.write("250 fake.localhost\r\n");
        else socket.write("502 no\r\n");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    return (server!.address() as { port: number }).port;
  }

  it("a server that refuses service is a permanent rejection", async () => {
    const port = await fake("554 no service here");
    const sender = new SmtpMailSender(
      { host: "127.0.0.1", port, security: "starttls", user: null, password: null },
      "Dream Petroleum <no-reply@example.com>",
    );
    await expect(
      sender.send({ to: ["sales@example.com"], subject: "s", text: "t" }),
    ).rejects.toMatchObject({ code: "smtp_rejected", permanent: true });
    sender.close();
  });

  it("a server without STARTTLS is never used in plain text (a configuration error, final)", async () => {
    seen.length = 0;
    const port = await fake("220 fake.localhost ESMTP");
    const sender = new SmtpMailSender(
      { host: "127.0.0.1", port, security: "starttls", user: null, password: null },
      "Dream Petroleum <no-reply@example.com>",
    );
    const error = await sender
      .send({ to: ["sales@example.com"], subject: "s", text: "t" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error.code).toMatch(/^smtp_/);
    // Nothing of the message went over the unencrypted connection.
    expect(
      seen.some((l) => l.startsWith("MAIL FROM") || l.startsWith("RCPT") || l.startsWith("DATA")),
    ).toBe(false);
    sender.close();
  });

  it("an unreachable server is a temporary failure", async () => {
    const port = await fake("220 x");
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    const sender = new SmtpMailSender(
      { host: "127.0.0.1", port, security: "starttls", user: null, password: null },
      "Dream Petroleum <no-reply@example.com>",
    );
    await expect(
      sender.send({ to: ["sales@example.com"], subject: "s", text: "t" }),
    ).rejects.toMatchObject({ code: "smtp_unavailable", permanent: false });
    sender.close();
  });
});

describe("DP-221 notification e-mail", () => {
  it("names the site, the time and the admin link, and nothing about the sender", () => {
    const mail = notificationMail({
      to: ["sales@example.com"],
      siteName: "Dream Petroleum BV",
      receivedAt: new Date("2026-11-19T09:30:00Z"),
      leadUrl: "https://admin.example.com/leads/0196f0a0-0000-7000-8000-000000000001",
    });
    expect(mail.subject).toBe("New contact form message – Dream Petroleum BV");
    expect(mail.text).toContain(
      "https://admin.example.com/leads/0196f0a0-0000-7000-8000-000000000001",
    );
    expect(mail.text).toContain("19 November 2026 at 10:30");
    expect(mail.text).toMatch(/does not contain the sender's details or the message/);
    expect(mail.to).toEqual(["sales@example.com"]);
  });
});
