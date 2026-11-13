import Link from "next/link";
import { buttonStyles } from "../components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
      <p className="tabular text-sm text-ink-3">404</p>
      <h1 className="type-display mt-2 text-[2rem] font-semibold text-ink">Page not found</h1>
      <p className="mt-2 max-w-[44ch] text-ink-2">
        This address does not exist in the admin console. Check the link or go back to the overview.
      </p>
      <Link href="/" className={`${buttonStyles.secondary} mt-6`}>
        Back to overview
      </Link>
    </main>
  );
}
