import Link from "next/link";
import { buttonStyles } from "../components/ui";
import { getTranslator } from "../lib/i18n/server";

export default async function NotFound() {
  const t = await getTranslator();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
      <p className="tabular text-sm text-ink-3">404</p>
      <h1 className="type-display mt-2 text-[2rem] font-semibold text-ink">
        {t("notFound.title")}
      </h1>
      <p className="mt-2 max-w-[44ch] text-ink-2">{t("notFound.text")}</p>
      <Link href="/" className={`${buttonStyles.secondary} mt-6`}>
        {t("common.backToOverview")}
      </Link>
    </main>
  );
}
