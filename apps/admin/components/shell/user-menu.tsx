"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { Avatar, cx } from "../ui";

export interface ShellUser {
  name: string;
  email: string;
}

const LOGOUT_PATH = "/api/v1/auth/staff/logout";

export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      // Same-origin call through the admin proxy; the API clears the session cookie.
      await fetch(LOGOUT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
    } finally {
      // Whatever the API answered, leave the console; /login re-checks the session.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-surface-2 aria-expanded:bg-surface-2 sm:pr-3"
      >
        <Avatar name={user.name} />
        <span className="hidden max-w-[14ch] truncate text-sm font-medium text-ink sm:block">
          {user.name}
        </span>
        <span className="sr-only">Account menu</span>
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="Account"
        hidden={!open}
        className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 origin-top-right rounded-xl border border-line bg-surface-raised p-1.5 shadow-raised"
      >
        <div className="px-3 pb-2.5 pt-2">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-3">{user.email}</p>
        </div>
        <div className="my-1 h-px bg-line" />
        <Link
          role="menuitem"
          href="/settings"
          onClick={() => setOpen(false)}
          className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="settings" size={17} />
          Account settings
        </Link>
        <button
          role="menuitem"
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className={cx(
            "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger",
            signingOut && "opacity-60",
          )}
        >
          <Icon name="logout" size={17} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
