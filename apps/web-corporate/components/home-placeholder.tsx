/**
 * COM-2a: the corporate home until its designed page (`corporate.home`, COM-2b): the site's name
 * and the interface notice that the new site is being prepared, in the corporate design. No
 * claim, figure or picture: the content of the home page comes from the CMS in COM-2b.
 */
import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";

export function HomePlaceholder({ locale }: { locale: RouteLocale }) {
  const t = dictionary(locale);
  return (
    <header className="hero on-dark">
      <div className="container-site">
        <h1>{t.home.title}</h1>
        <p className="hero-intro">{t.home.text}</p>
      </div>
    </header>
  );
}
