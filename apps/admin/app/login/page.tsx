import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "../../components/auth/auth-frame";
import { LoginForm } from "../../components/auth/login-form";
import { getStaffSession } from "../../lib/server-session";
import { getTranslator } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("login.metaTitle") };
}
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
  const t = await getTranslator();

  return (
    <AuthFrame>
      <h1 className="type-display text-[2rem] font-semibold text-ink">{t("login.title")}</h1>
      <p className="mb-8 mt-2 text-ink-2">{t("login.intro")}</p>
      <LoginForm />
      <p className="mt-8 text-sm text-ink-3">{t("login.lockedOut")}</p>
    </AuthFrame>
  );
}
