import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "../../components/auth/auth-frame";
import { LoginForm } from "../../components/auth/login-form";
import { getStaffSession } from "../../lib/server-session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

async function hasSession(): Promise<boolean> {
  try {
    return (await getStaffSession()) !== null;
  } catch {
    // API unreachable: show the form; signing in will report the problem.
    return false;
  }
}

export default async function LoginPage() {
  if (await hasSession()) redirect("/");

  return (
    <AuthFrame>
      <h1 className="type-display text-[2rem] font-semibold text-ink">Sign in</h1>
      <p className="mb-8 mt-2 text-ink-2">
        Use your staff account. You will need your authenticator app.
      </p>
      <LoginForm />
      <p className="mt-8 text-sm text-ink-3">
        Locked out or lost your authenticator? Ask a platform administrator for a recovery link.
      </p>
    </AuthFrame>
  );
}
