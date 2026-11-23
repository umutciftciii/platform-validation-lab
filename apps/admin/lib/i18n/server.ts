/**
 * Server side of the admin UI language (ML-11): reads the `dp-admin-locale` cookie of the request.
 * Only a display preference: an unknown or tampered value is English, and nothing here touches the
 * session cookies or grants anything.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { ADMIN_LOCALE_COOKIE, type AdminLocale, parseAdminLocale } from "./config";
import { createTranslator } from "./translate";
import type { Translate } from "./types";

export const getAdminLocale = cache(async (): Promise<AdminLocale> => {
  const jar = await cookies();
  return parseAdminLocale(jar.get(ADMIN_LOCALE_COOKIE)?.value);
});

export async function getTranslator(): Promise<Translate> {
  return createTranslator(await getAdminLocale());
}
