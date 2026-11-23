/**
 * Types of the admin dictionary (ML-11, ADR-028 D15). The English messages are the source: their
 * shape is the key type, and every other language must satisfy `Messages`, so a missing or extra
 * key in Turkish is a compile error. Parameters are read from the English text: `t()` requires
 * exactly the `{name}` placeholders of the message, and `count` for a plural.
 */
import type { en } from "./messages/en";

/** A message with plural forms, chosen by `count` (Intl.PluralRules "one" / "other"). */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

type Widen<T> = T extends string
  ? string
  : T extends PluralForms
    ? PluralForms
    : { readonly [K in keyof T]: Widen<T[K]> };

/** The shape every language's dictionary has: the English keys, any strings. */
export type Messages = Widen<typeof en>;

type Leaf = string | PluralForms;

type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every message key, e.g. "login.title" or "nav.items.staff.label". */
export type MessageKey = Paths<typeof en>;

/** The English message at a key. */
export type MessageAt<K extends string, T = typeof en> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? MessageAt<Rest, T[Head]>
    : never
  : K extends keyof T
    ? T[K]
    : never;

type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type ParamValue = string | number;

/** The parameters a message needs; `undefined` when it has none. */
export type ParamsOf<V> = V extends PluralForms
  ? { count: number } & Record<Exclude<Placeholders<V["one"] | V["other"]>, "count">, ParamValue>
  : [Placeholders<V>] extends [never]
    ? undefined
    : Record<Placeholders<V>, ParamValue>;

/** `t(key)` for messages without parameters, `t(key, params)` otherwise. */
export type TArgs<K extends MessageKey> =
  ParamsOf<MessageAt<K>> extends undefined ? [] : [params: ParamsOf<MessageAt<K>>];

export type Translate = <K extends MessageKey>(key: K, ...args: TArgs<K>) => string;

/** Keys of messages without parameters (usable as `<Msg k="…" />`). */
export type PlainKey = { [K in MessageKey]: TArgs<K> extends [] ? K : never }[MessageKey];
