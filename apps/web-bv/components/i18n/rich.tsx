import { Fragment, type ReactNode } from "react";

import { parts } from "@/lib/i18n/format";

/**
 * ML-6: a dictionary template with markup in its placeholders, e.g.
 * `<Rich text={ui.noMatchText} values={{ clear: <Link …>{ui.clearSearch}</Link> }} />`.
 * The words stay in one template per language (word order differs between languages); the
 * markup is the caller's. No hooks: usable in server and client components.
 */
export function Rich({ text, values }: { text: string; values: Readonly<Record<string, ReactNode>> }) {
  return (
    <>
      {parts(text, values).map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
