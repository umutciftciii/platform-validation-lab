/**
 * COM-2b (DP-094): the product portfolio at /products from the published `corporate.products`:
 * the page heading, a list of the groups on this page, one anchored section per group (its
 * address is /products#<anchor>, the live site's anchors), the typical values table and the COA
 * request. Every text is the CMS content; only the section list and the table headings are
 * interface labels (lib/i18n.ts). This is not the BV catalogue: no product pages, no data sheets.
 *
 * Typical values (DP-002): the table is shown only when it has rows; the import leaves it empty
 * until the source of the values is approved, so the section is not on the page at all.
 */
import type { CorporateProductGroup, CorporateProductsContent } from "@dream/contracts";

import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { gradeLayout, paragraphsOf, showsTypicalValues } from "@/lib/section-view";

function Paragraphs({ text, className }: { text: string | null; className?: string }) {
  const list = paragraphsOf(text);
  if (!list.length) return null;
  return (
    <div className={`rich ${className ?? ""}`}>
      {list.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/** Grades with a description are cards; bare grade names are a compact list. */
function Items({ items }: { items: CorporateProductGroup["items"] }) {
  const layout = gradeLayout(items);
  if (layout === "none") return null;
  if (layout === "chips") {
    return (
      <ul className="grade-chips">
        {items.map((i) => (
          <li key={i.name}>{i.name}</li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grade-list">
      {items.map((i) => (
        <li key={i.name}>
          {i.type ? <p className="grade-type">{i.type}</p> : null}
          <h3>{i.name}</h3>
          {i.description ? <p>{i.description}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function Group({ group, tint }: { group: CorporateProductGroup; tint: boolean }) {
  const headingId = `${group.anchor}-title`;
  return (
    <section
      id={group.anchor}
      className={`section product-group ${tint ? "section-tint" : "section-plain"}`}
      aria-labelledby={headingId}
    >
      <div className="container-site product-group-grid">
        <div className="split-head">
          {group.eyebrow ? <p className="eyebrow">{group.eyebrow}</p> : null}
          <h2 id={headingId} className="section-title">
            {group.title}
          </h2>
          {group.subtitle ? <p className="group-subtitle">{group.subtitle}</p> : null}
        </div>
        <div className="product-group-body">
          <Paragraphs text={group.description} className="section-lead" />
          <Items items={group.items} />
          {group.applications.length ? (
            <div className="applications">
              {group.applicationsTitle ? <h3>{group.applicationsTitle}</h3> : null}
              <ul className="cta-points on-light">
                {group.applications.map((a) => (
                  <li key={a.text}>{a.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {group.link ? (
            <p className="m-0">
              <a className="btn btn-primary btn-arrow" href={group.link.href}>
                {group.link.label}
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TypicalValues({
  table,
  locale,
}: {
  table: CorporateProductsContent["typicalValues"];
  locale: RouteLocale;
}) {
  if (!showsTypicalValues(table)) return null;
  const t = dictionary(locale).portfolio;
  return (
    <section className="section section-plain" aria-label={table.title ?? undefined}>
      <div className="container-site">
        <div className="table-wrap">
          <table className="values-table">
            {table.title ? <caption>{table.title}</caption> : null}
            <thead>
              <tr>
                <th scope="col">{t.property}</th>
                <th scope="col">{t.unit}</th>
                <th scope="col">{table.columnA ?? ""}</th>
                <th scope="col">{table.columnB ?? ""}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.property}>
                  <th scope="row">{r.property}</th>
                  <td>{r.unit ?? ""}</td>
                  <td>{r.valueA ?? ""}</td>
                  <td>{r.valueB ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.note ? <p className="table-note">{table.note}</p> : null}
      </div>
    </section>
  );
}

export function ProductsPage({
  content,
  locale,
}: {
  content: CorporateProductsContent;
  locale: RouteLocale;
}) {
  const { intro, groups, typicalValues, coa } = content;
  const t = dictionary(locale).portfolio;
  return (
    <article>
      <header className="hero hero-compact on-dark">
        <div className="container-site">
          {intro.eyebrow ? <p className="eyebrow">{intro.eyebrow}</p> : null}
          <h1>{intro.title}</h1>
          <Paragraphs text={intro.intro} className="hero-intro" />
          {groups.length > 1 ? (
            <nav className="anchor-nav" aria-label={t.onThisPage}>
              <ul>
                {groups.map((g) => (
                  <li key={g.anchor}>
                    <a href={`#${g.anchor}`}>{g.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>
      {groups.map((g, i) => (
        <Group key={g.anchor} group={g} tint={i % 2 === 1} />
      ))}
      <TypicalValues table={typicalValues} locale={locale} />
      <section className="section section-plain">
        <div className="container-site">
          <div className="cta-panel on-dark">
            <div>
              <h2>{coa.title}</h2>
              {coa.text ? <p>{coa.text}</p> : null}
            </div>
            <div>
              <a className="btn btn-accent btn-arrow" href={coa.button.href}>
                {coa.button.label}
              </a>
            </div>
          </div>
        </div>
      </section>
    </article>
  );
}
