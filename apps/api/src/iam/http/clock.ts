import { Injectable } from "@nestjs/common";

/**
 * The time source of authentication decisions (session timeouts, step-up age, token expiry,
 * throttle, TOTP). Production uses the system clock; the HTTP tests move it forward to prove the
 * timeouts (NT-S5, NT-D2) without waiting.
 */
@Injectable()
export class Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  /** Test support: moves this clock forward. Never called by production code. */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("the clock only moves forward");
    this.offsetMs += ms;
  }
}

/**
 * Test support for AC-DA-2 (no partial deactivation): a named point inside a transaction can be
 * made to throw. Production code calls `check`, which does nothing unless a test armed it.
 */
@Injectable()
export class FaultInjector {
  armed: string | null = null;

  check(point: string): void {
    if (this.armed === point) {
      this.armed = null;
      throw new Error(`injected fault at ${point}`);
    }
  }
}
