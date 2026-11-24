"use client";

/**
 * DP-219: the editors of the BV header (`bv.site-nav`) and footer (`bv.site-footer`) menus. They
 * replace the generic field form for these two fragments; saving, preview, publication, history
 * and restore stay the page editor's (one CMS flow, ADR-020).
 *
 * A hierarchical list with up/down buttons (no drag and drop), a target picker per link (CMS page,
 * product, category, site path or anchor, external address, not ready yet), visibility and "new
 * tab" switches, a structure preview of what the site will show, warnings for targets that are not
 * live, and the reference conversion: fixed site paths that can become content references.
 */
import {
  BV_NAV_KEY,
  MENU_LIMITS,
  MENU_SOCIAL_NETWORKS,
  MENU_TARGET_PROBLEMS,
  footerLinks,
  menuReferencePlan,
  menuTargetCheck,
  navLinks,
  type BvFooterMenu,
  type BvNavMenu,
  type CmsMenuKey,
  type CmsMenuTargetsResponse,
  type MenuLink,
  type MenuNavItem,
  type MenuSocialNetwork,
  type MenuTarget,
  type MenuTargetType,
} from "@dream/contracts";
import { useId } from "react";
import { cmsText } from "../../lib/cms-text";
import { INTL_LOCALE } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { Field, FIELD, TEXTAREA } from "../catalog/parts";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, StatusPill } from "../ui";
import { IconButton, move } from "./field-form";

type Invalid = (path: string) => true | undefined;

export type MenuValue = BvNavMenu | BvFooterMenu;

/** The kinds of target, in the picker's order (labels: `content.menus.target.<type>`). */
const TARGET_TYPES: readonly MenuTargetType[] = [
  "page",
  "product",
  "category",
  "path",
  "url",
  "none",
];

/**
 * Network names are brand names: not translated. Only `other` is a UI word
 * (`content.menus.footer.networkOther`).
 */
const SOCIAL_BRAND: Record<Exclude<MenuSocialNetwork, "other">, string> = {
  // i18n-ignore: brand names
  linkedin: "LinkedIn",
  x: "X",
  // i18n-ignore: brand names
  facebook: "Facebook",
  // i18n-ignore: brand names
  instagram: "Instagram",
  // i18n-ignore: brand names
  youtube: "YouTube",
};

const newLink = (): MenuLink => ({
  // i18n-ignore: default content of a new menu item (data, content language)
  label: "New link",
  target: { type: "none" },
  newTab: false,
  visible: true,
});

export function MenuEditor({
  menuKey,
  value,
  targets,
  readOnly,
  invalid,
  onChange,
}: {
  menuKey: CmsMenuKey;
  value: MenuValue;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  onChange: (v: MenuValue) => void;
}) {
  return (
    <>
      {menuKey === BV_NAV_KEY ? (
        <NavEditor
          key="nav"
          value={value as BvNavMenu}
          targets={targets}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
      ) : (
        <FooterEditor
          key="footer"
          value={value as BvFooterMenu}
          targets={targets}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
      )}
      <ReferencePanel
        menuKey={menuKey}
        value={value}
        targets={targets}
        readOnly={readOnly}
        onChange={onChange}
      />
      <StructurePreview menuKey={menuKey} value={value} targets={targets} />
    </>
  );
}

// --- header ------------------------------------------------------------------------------------

function NavEditor({
  value,
  targets,
  readOnly,
  invalid,
  onChange,
}: {
  value: BvNavMenu;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  onChange: (v: BvNavMenu) => void;
}) {
  const t = useT();
  const setItems = (items: MenuNavItem[]) => onChange({ ...value, items });
  return (
    <>
      <Panel
        id="menu-items"
        title={t("content.menus.nav.title")}
        description={t("content.menus.nav.description", {
          count: value.items.length,
          max: MENU_LIMITS.navItems,
        })}
      >
        <ol className="space-y-4">
          {value.items.map((item, i) => (
            <li
              key={`item-${i}`}
              className={cx(
                "rounded-xl border bg-surface",
                invalid(`content.items.${i}`) ? "border-danger/50" : "border-line",
              )}
            >
              <LinkEditor
                path={`content.items.${i}`}
                title={t("content.menus.nav.item", { n: i + 1 })}
                link={item}
                targets={targets}
                readOnly={readOnly}
                invalid={invalid}
                index={i}
                count={value.items.length}
                onChange={(l) =>
                  setItems(value.items.map((x, k) => (k === i ? { ...x, ...l } : x)))
                }
                onMove={(to) => setItems(move(value.items, i, to))}
                onRemove={
                  value.items.length > 1
                    ? () => setItems(value.items.filter((_, k) => k !== i))
                    : undefined
                }
              />
              <div className="border-t border-line px-4 py-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                  <span>{t("content.menus.nav.submenuOf", { label: item.label })}</span>
                </p>
                {item.children.length ? (
                  <ol className="space-y-3 border-l-2 border-line pl-3">
                    {item.children.map((child, j) => (
                      <li
                        key={`child-${j}`}
                        className="rounded-lg border border-line bg-surface-2/40"
                      >
                        <LinkEditor
                          path={`content.items.${i}.children.${j}`}
                          title={t("content.menus.nav.submenuLink", { n: j + 1 })}
                          link={child}
                          targets={targets}
                          readOnly={readOnly}
                          invalid={invalid}
                          index={j}
                          count={item.children.length}
                          onChange={(l) =>
                            setItems(
                              value.items.map((x, k) =>
                                k === i
                                  ? {
                                      ...x,
                                      children: x.children.map((c, m) =>
                                        m === j ? { ...c, ...l } : c,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                          onMove={(to) =>
                            setItems(
                              value.items.map((x, k) =>
                                k === i ? { ...x, children: move(x.children, j, to) } : x,
                              ),
                            )
                          }
                          onRemove={() =>
                            setItems(
                              value.items.map((x, k) =>
                                k === i
                                  ? { ...x, children: x.children.filter((_, m) => m !== j) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-ink-3">
                    <span>{t("content.menus.nav.noSubmenu")}</span>
                  </p>
                )}
                {!readOnly ? (
                  <AddButton
                    label={t("content.menus.nav.addSubmenuLink")}
                    disabled={item.children.length >= MENU_LIMITS.navChildren}
                    onClick={() =>
                      setItems(
                        value.items.map((x, k) =>
                          k === i ? { ...x, children: [...x.children, newLink()] } : x,
                        ),
                      )
                    }
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {!readOnly ? (
          <AddButton
            label={t("content.menus.nav.addItem")}
            disabled={value.items.length >= MENU_LIMITS.navItems}
            onClick={() => setItems([...value.items, { ...newLink(), children: [] }])}
          />
        ) : null}
      </Panel>

      <Panel
        id="menu-contact"
        title={t("content.menus.nav.contactTitle")}
        description={t("content.menus.nav.contactDescription")}
      >
        <div className="rounded-xl border border-line">
          <LinkEditor
            path="content.contact"
            title={t("content.menus.shared.button")}
            link={value.contact}
            targets={targets}
            readOnly={readOnly}
            invalid={invalid}
            onChange={(l) => onChange({ ...value, contact: { ...value.contact, ...l } })}
          />
        </div>
      </Panel>

      <Panel
        id="menu-noscript"
        title={t("content.menus.nav.noScriptTitle")}
        description={t("content.menus.nav.noScriptDescription")}
      >
        <LinkList
          // i18n-ignore: field path of the validation issues (code)
          path="content.noScriptLinks"
          itemTitle={t("content.menus.nav.link")}
          addLabel={t("content.menus.nav.addLink")}
          links={value.noScriptLinks}
          max={MENU_LIMITS.noScriptLinks}
          targets={targets}
          readOnly={readOnly}
          invalid={invalid}
          onChange={(noScriptLinks) => onChange({ ...value, noScriptLinks })}
        />
      </Panel>

      <Panel id="menu-texts" title={t("content.menus.nav.textsTitle")}>
        <TextInput
          id="menu-pending-note"
          label={t("content.menus.shared.pendingNote")}
          value={value.pendingNote}
          max={120}
          readOnly={readOnly}
          // i18n-ignore: field path of the validation issues (code)
          invalid={invalid("content.pendingNote")}
          onChange={(pendingNote) => onChange({ ...value, pendingNote })}
        />
      </Panel>
    </>
  );
}

// --- footer ------------------------------------------------------------------------------------

function FooterEditor({
  value,
  targets,
  readOnly,
  invalid,
  onChange,
}: {
  value: BvFooterMenu;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  onChange: (v: BvFooterMenu) => void;
}) {
  const t = useT();
  const contact = value.contact;
  const setContact = (patch: Partial<BvFooterMenu["contact"]>) =>
    onChange({ ...value, contact: { ...contact, ...patch } });
  return (
    <>
      <Panel id="footer-call" title={t("content.menus.footer.callTitle")}>
        <div className="space-y-4">
          <TextInput
            id="footer-headline"
            label={t("content.menus.footer.headline")}
            value={value.headline}
            max={120}
            readOnly={readOnly}
            invalid={invalid("content.headline")}
            onChange={(headline) => onChange({ ...value, headline })}
          />
          <div className="rounded-xl border border-line">
            <LinkEditor
              path="content.cta"
              title={t("content.menus.shared.button")}
              link={{ ...value.cta, visible: true }}
              targets={targets}
              readOnly={readOnly}
              invalid={invalid}
              alwaysVisible
              onChange={(l) =>
                onChange({
                  ...value,
                  cta: {
                    label: l.label ?? value.cta.label,
                    // The picker offers no "not ready" here (alwaysVisible); the API checks it too.
                    target: (l.target ?? value.cta.target) as BvFooterMenu["cta"]["target"],
                    newTab: l.newTab ?? value.cta.newTab,
                  },
                })
              }
            />
          </div>
          <TextInput
            id="footer-intro"
            label={t("content.menus.footer.intro")}
            value={value.intro}
            max={500}
            multiline
            readOnly={readOnly}
            invalid={invalid("content.intro")}
            onChange={(intro) => onChange({ ...value, intro })}
          />
        </div>
      </Panel>

      <Panel
        id="footer-contact"
        title={t("content.menus.footer.contactTitle")}
        description={t("content.menus.footer.contactDescription")}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              // DP-271: not "footer-contact-title", the id of the panel's own heading (Panel adds
              // "-title" to its id), which made the label point at the h2 and left this input unnamed.
              id="footer-contact-heading"
              label={t("content.menus.shared.heading")}
              value={contact.title}
              max={60}
              readOnly={readOnly}
              invalid={invalid("content.contact.title")}
              onChange={(title) => setContact({ title })}
            />
            <TextInput
              id="footer-contact-company"
              label={t("content.menus.footer.company")}
              value={contact.company}
              max={120}
              readOnly={readOnly}
              invalid={invalid("content.contact.company")}
              onChange={(company) => setContact({ company })}
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">
              {t("content.menus.footer.addressLines")}
            </legend>
            <ol className="space-y-2">
              {contact.addressLines.map((line, i) => (
                <li key={`line-${i}`} className="flex items-center gap-2">
                  <input
                    aria-label={t("content.menus.footer.addressLine", { n: i + 1 })}
                    value={line.text}
                    maxLength={120}
                    readOnly={readOnly}
                    // i18n-ignore: field path of the validation issues (code)
                    aria-invalid={invalid(`content.contact.addressLines.${i}`)}
                    onChange={(e) =>
                      setContact({
                        addressLines: contact.addressLines.map((l, k) =>
                          k === i ? { text: e.currentTarget.value } : l,
                        ),
                      })
                    }
                    className={FIELD}
                  />
                  {!readOnly ? (
                    <IconButton
                      label={t("content.menus.footer.removeAddressLine", { n: i + 1 })}
                      disabled={contact.addressLines.length <= 1}
                      onClick={() =>
                        setContact({ addressLines: contact.addressLines.filter((_, k) => k !== i) })
                      }
                    >
                      <Icon name="trash" size={16} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ol>
            {!readOnly ? (
              <AddButton
                label={t("content.menus.footer.addAddressLine")}
                disabled={contact.addressLines.length >= 4}
                onClick={() =>
                  setContact({ addressLines: [...contact.addressLines, { text: "" }] })
                }
              />
            ) : null}
          </fieldset>
          {(["phone", "email"] as const).map((k) => (
            <fieldset key={k} className="rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-medium text-ink">
                {k === "phone" ? t("content.menus.footer.phone") : t("content.menus.footer.email")}
              </legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextInput
                  id={`footer-${k}-label`}
                  label={t("content.menus.footer.shownAs")}
                  value={contact[k].label}
                  max={k === "phone" ? 60 : 120}
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.label`)}
                  onChange={(label) => setContact({ [k]: { ...contact[k], label } })}
                />
                <TextInput
                  id={`footer-${k}-href`}
                  label={
                    k === "phone"
                      ? t("content.menus.footer.phoneHref")
                      : t("content.menus.footer.emailHref")
                  }
                  value={contact[k].href}
                  max={k === "phone" ? 60 : 200}
                  mono
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.href`)}
                  onChange={(href) => setContact({ [k]: { ...contact[k], href } })}
                />
                <TextInput
                  id={`footer-${k}-note`}
                  label={t("content.menus.footer.note")}
                  value={contact[k].note}
                  max={80}
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.note`)}
                  onChange={(note) => setContact({ [k]: { ...contact[k], note } })}
                />
              </div>
              <Toggle
                id={`footer-${k}-visible`}
                label={t("content.menus.shared.shownOnSite")}
                checked={contact[k].visible}
                readOnly={readOnly}
                onChange={(visible) => setContact({ [k]: { ...contact[k], visible } })}
              />
            </fieldset>
          ))}
        </div>
      </Panel>

      <Panel
        id="footer-columns"
        title={t("content.menus.footer.columnsTitle")}
        description={t("content.menus.footer.columnsDescription", {
          count: value.columns.length,
          max: MENU_LIMITS.footerColumns,
        })}
      >
        <ol className="space-y-4">
          {value.columns.map((col, i) => {
            const setCol = (patch: Partial<BvFooterMenu["columns"][number]>) =>
              onChange({
                ...value,
                columns: value.columns.map((c, k) => (k === i ? { ...c, ...patch } : c)),
              });
            return (
              <li
                key={`col-${i}`}
                className={cx(
                  "rounded-xl border bg-surface",
                  invalid(`content.columns.${i}`) ? "border-danger/50" : "border-line",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-ink">
                    <span>{t("content.menus.footer.column", { n: i + 1 })}</span>
                  </h3>
                  {!readOnly ? (
                    <div className="flex items-center gap-1">
                      <IconButton
                        label={t("content.menus.footer.moveColumnUp", { n: i + 1 })}
                        disabled={i === 0}
                        onClick={() =>
                          onChange({ ...value, columns: move(value.columns, i, i - 1) })
                        }
                      >
                        <Icon name="chevron" size={16} className="-rotate-90" />
                      </IconButton>
                      <IconButton
                        label={t("content.menus.footer.moveColumnDown", { n: i + 1 })}
                        disabled={i === value.columns.length - 1}
                        onClick={() =>
                          onChange({ ...value, columns: move(value.columns, i, i + 1) })
                        }
                      >
                        <Icon name="chevron" size={16} className="rotate-90" />
                      </IconButton>
                      <IconButton
                        label={t("content.menus.footer.removeColumn", { n: i + 1 })}
                        disabled={value.columns.length <= 1}
                        onClick={() =>
                          onChange({ ...value, columns: value.columns.filter((_, k) => k !== i) })
                        }
                      >
                        <Icon name="trash" size={16} />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <TextInput
                      id={`footer-col-${i}-title`}
                      label={t("content.menus.shared.heading")}
                      value={col.title}
                      max={60}
                      readOnly={readOnly}
                      invalid={invalid(`content.columns.${i}.title`)}
                      onChange={(title) => setCol({ title })}
                    />
                    <Toggle
                      id={`footer-col-${i}-visible`}
                      label={t("content.menus.footer.columnShown")}
                      checked={col.visible}
                      readOnly={readOnly}
                      onChange={(visible) => setCol({ visible })}
                    />
                  </div>
                  <LinkList
                    path={`content.columns.${i}.links`}
                    itemTitle={t("content.menus.footer.link")}
                    addLabel={t("content.menus.footer.addLink")}
                    links={col.links}
                    min={1}
                    max={MENU_LIMITS.columnLinks}
                    targets={targets}
                    readOnly={readOnly}
                    invalid={invalid}
                    onChange={(links) => setCol({ links })}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        {!readOnly ? (
          <AddButton
            label={t("content.menus.footer.addColumn")}
            disabled={value.columns.length >= MENU_LIMITS.footerColumns}
            onClick={() =>
              onChange({
                ...value,
                columns: [
                  ...value.columns,
                  // i18n-ignore: default content of a new menu item (data, content language)
                  { title: "New column", visible: true, links: [newLink()] },
                ],
              })
            }
          />
        ) : null}
      </Panel>

      <Panel
        id="footer-social"
        title={t("content.menus.footer.socialTitle")}
        description={t("content.menus.footer.socialDescription")}
      >
        {value.social.length ? (
          <ol className="space-y-3">
            {value.social.map((s, i) => {
              const setSocial = (patch: Partial<BvFooterMenu["social"][number]>) =>
                onChange({
                  ...value,
                  social: value.social.map((x, k) => (k === i ? { ...x, ...patch } : x)),
                });
              return (
                <li key={`social-${i}`} className="rounded-xl border border-line p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.4fr)]">
                    <Field
                      label={t("content.menus.footer.network")}
                      htmlFor={`footer-social-${i}-network`}
                    >
                      <select
                        id={`footer-social-${i}-network`}
                        value={s.network}
                        disabled={readOnly}
                        onChange={(e) =>
                          setSocial({ network: e.currentTarget.value as MenuSocialNetwork })
                        }
                        className={FIELD}
                      >
                        {MENU_SOCIAL_NETWORKS.map((n) => (
                          <option key={n} value={n}>
                            {n === "other"
                              ? t("content.menus.footer.networkOther")
                              : SOCIAL_BRAND[n]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <TextInput
                      id={`footer-social-${i}-label`}
                      label={t("content.menus.shared.label")}
                      value={s.label}
                      max={60}
                      readOnly={readOnly}
                      invalid={invalid(`content.social.${i}.label`)}
                      onChange={(label) => setSocial({ label })}
                    />
                    <TextInput
                      id={`footer-social-${i}-url`}
                      label={t("content.menus.footer.socialUrl")}
                      value={s.url}
                      max={500}
                      mono
                      readOnly={readOnly}
                      invalid={invalid(`content.social.${i}.url`)}
                      onChange={(url) => setSocial({ url })}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Toggle
                      id={`footer-social-${i}-visible`}
                      label={t("content.menus.shared.shownOnSite")}
                      checked={s.visible}
                      readOnly={readOnly}
                      onChange={(visible) => setSocial({ visible })}
                    />
                    {!readOnly ? (
                      <div className="flex items-center gap-1">
                        <IconButton
                          label={t("content.menus.footer.moveSocialUp", { n: i + 1 })}
                          disabled={i === 0}
                          onClick={() =>
                            onChange({ ...value, social: move(value.social, i, i - 1) })
                          }
                        >
                          <Icon name="chevron" size={16} className="-rotate-90" />
                        </IconButton>
                        <IconButton
                          label={t("content.menus.footer.moveSocialDown", { n: i + 1 })}
                          disabled={i === value.social.length - 1}
                          onClick={() =>
                            onChange({ ...value, social: move(value.social, i, i + 1) })
                          }
                        >
                          <Icon name="chevron" size={16} className="rotate-90" />
                        </IconButton>
                        <IconButton
                          label={t("content.menus.footer.removeSocial", { n: i + 1 })}
                          onClick={() =>
                            onChange({ ...value, social: value.social.filter((_, k) => k !== i) })
                          }
                        >
                          <Icon name="trash" size={16} />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-ink-3">
            <span>{t("content.menus.footer.noSocial")}</span>
          </p>
        )}
        {!readOnly ? (
          <AddButton
            label={t("content.menus.footer.addSocial")}
            disabled={value.social.length >= MENU_LIMITS.social}
            onClick={() =>
              onChange({
                ...value,
                social: [
                  ...value.social,
                  // i18n-ignore: default content of a new social link (data, brand name)
                  { network: "linkedin", label: "LinkedIn", url: "https://", visible: true },
                ],
              })
            }
          />
        ) : null}
      </Panel>

      <Panel id="footer-legal" title={t("content.menus.footer.legalTitle")}>
        <div className="space-y-4">
          <TextInput
            id="footer-copyright"
            label={t("content.menus.footer.copyright")}
            value={value.copyright}
            max={200}
            readOnly={readOnly}
            invalid={invalid("content.copyright")}
            onChange={(copyright) => onChange({ ...value, copyright })}
          />
          <LinkList
            path="content.legal"
            itemTitle={t("content.menus.footer.legalLink")}
            addLabel={t("content.menus.footer.addLegalLink")}
            links={value.legal}
            max={MENU_LIMITS.legal}
            targets={targets}
            readOnly={readOnly}
            invalid={invalid}
            onChange={(legal) => onChange({ ...value, legal })}
          />
          <p className="text-xs text-ink-3">
            <span>{t("content.menus.footer.privacyNote")}</span>
          </p>
          <TextInput
            id="footer-pending-note"
            label={t("content.menus.shared.pendingNote")}
            value={value.pendingNote}
            max={120}
            readOnly={readOnly}
            // i18n-ignore: field path of the validation issues (code)
            invalid={invalid("content.pendingNote")}
            onChange={(pendingNote) => onChange({ ...value, pendingNote })}
          />
        </div>
      </Panel>
    </>
  );
}

// --- one link --------------------------------------------------------------------------------------

function LinkList({
  path,
  itemTitle,
  addLabel,
  links,
  min = 0,
  max,
  targets,
  readOnly,
  invalid,
  onChange,
}: {
  path: string;
  itemTitle: string;
  /** The add button ("Add link"). */
  addLabel: string;
  links: MenuLink[];
  min?: number;
  max: number;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  onChange: (links: MenuLink[]) => void;
}) {
  const t = useT();
  return (
    <div>
      {links.length ? (
        <ol className="space-y-3">
          {links.map((link, i) => (
            <li key={`link-${i}`} className="rounded-lg border border-line">
              <LinkEditor
                path={`${path}.${i}`}
                title={`${itemTitle} ${i + 1}`}
                link={link}
                targets={targets}
                readOnly={readOnly}
                invalid={invalid}
                index={i}
                count={links.length}
                onChange={(l) => onChange(links.map((x, k) => (k === i ? { ...x, ...l } : x)))}
                onMove={(to) => onChange(move(links, i, to))}
                onRemove={
                  links.length > min ? () => onChange(links.filter((_, k) => k !== i)) : undefined
                }
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-3">
          <span>{t("content.menus.link.noLinks")}</span>
        </p>
      )}
      {!readOnly ? (
        <AddButton
          label={addLabel}
          disabled={links.length >= max}
          onClick={() => onChange([...links, newLink()])}
        />
      ) : null}
    </div>
  );
}

function LinkEditor({
  path,
  title,
  link,
  targets,
  readOnly,
  invalid,
  index,
  count,
  alwaysVisible = false,
  onChange,
  onMove,
  onRemove,
}: {
  path: string;
  title: string;
  link: MenuLink;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  index?: number;
  count?: number;
  alwaysVisible?: boolean;
  onChange: (patch: Partial<MenuLink>) => void;
  onMove?: (to: number) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const lower = title.toLocaleLowerCase(INTL_LOCALE[useAdminLocale()]);
  const id = `menu-${path.replace(/[^a-z0-9]+/gi, "-")}`;
  const check = targets ? menuTargetCheck(link.target, targets) : null;
  const ordered = onMove && index !== undefined && count !== undefined;
  return (
    <div className={cx("space-y-3 p-4", !link.visible && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span>{title}</span>
          {link.visible ? null : (
            <StatusPill key="hidden" tone="neutral">
              {t("content.menus.link.hidden")}
            </StatusPill>
          )}
        </h3>
        {!readOnly && (ordered || onRemove) ? (
          <div className="flex items-center gap-1">
            {ordered ? (
              <IconButton
                label={t("content.menus.link.moveUp", { title: lower })}
                disabled={index === 0}
                onClick={() => onMove(index - 1)}
              >
                <Icon name="chevron" size={16} className="-rotate-90" />
              </IconButton>
            ) : null}
            {ordered ? (
              <IconButton
                label={t("content.menus.link.moveDown", { title: lower })}
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              >
                <Icon name="chevron" size={16} className="rotate-90" />
              </IconButton>
            ) : null}
            {onRemove ? (
              <IconButton
                label={t("content.menus.link.remove", { title: lower })}
                onClick={onRemove}
              >
                <Icon name="trash" size={16} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <TextInput
          id={`${id}-label`}
          label={t("content.menus.shared.label")}
          value={link.label}
          max={MENU_LIMITS.label}
          readOnly={readOnly}
          invalid={invalid(`${path}.label`)}
          onChange={(label) => onChange({ label })}
        />
        <TargetPicker
          id={`${id}-target`}
          target={link.target}
          targets={targets}
          readOnly={readOnly}
          allowNone={!alwaysVisible}
          invalid={invalid(`${path}.target`)}
          onChange={(target) => onChange({ target })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {alwaysVisible ? null : (
          <Toggle
            key="visible"
            id={`${id}-visible`}
            label={t("content.menus.shared.shownOnSite")}
            checked={link.visible}
            readOnly={readOnly}
            onChange={(visible) => onChange({ visible })}
          />
        )}
        <Toggle
          id={`${id}-newtab`}
          label={t("content.menus.link.newTab")}
          checked={link.newTab}
          readOnly={readOnly || link.target.type === "none"}
          onChange={(newTab) => onChange({ newTab })}
        />
      </div>
      {check ? <TargetStatus key="status" check={check} target={link.target} /> : null}
    </div>
  );
}

function TargetStatus({
  check,
  target,
}: {
  check: ReturnType<typeof menuTargetCheck>;
  target: MenuTarget;
}) {
  const t = useT();
  if (check.problem) {
    return (
      <p
        key="problem"
        role="note"
        className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/25"
      >
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <span>{cmsText(MENU_TARGET_PROBLEMS[check.problem], t)}</span>
      </p>
    );
  }
  return (
    <p key="ok" className="text-xs text-ink-3">
      <span>{statusText(check, target, t)}</span>
    </p>
  );
}

function statusText(
  check: ReturnType<typeof menuTargetCheck>,
  target: MenuTarget,
  t: Translate,
): string {
  if (target.type === "none") return t("content.menus.status.none");
  const href = check.href ?? "";
  return isReference(target.type)
    ? t("content.menus.status.reference", { href, kind: kindName(target.type, t) })
    : t("content.menus.status.fixed", { href });
}

const isReference = (type: MenuTargetType): type is "page" | "product" | "category" =>
  type === "page" || type === "product" || type === "category";

/** A content reference's kind inside a sentence ("page"); any other type stays its code. */
function kindName(type: MenuTargetType, t: Translate): string {
  return isReference(type) ? t(`content.menus.kind.${type}`) : type;
}

function TargetPicker({
  id,
  target,
  targets,
  readOnly,
  allowNone,
  invalid,
  onChange,
}: {
  id: string;
  target: MenuTarget;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  allowNone: boolean;
  invalid: true | undefined;
  onChange: (t: MenuTarget) => void;
}) {
  const t = useT();
  const types = TARGET_TYPES.filter(
    (ty) =>
      (allowNone || ty !== "none") &&
      (targets || !["page", "product", "category"].includes(ty) || ty === target.type),
  );
  function changeType(type: MenuTargetType) {
    switch (type) {
      case "page":
        onChange({ type, pageId: targets?.pages[0]?.id ?? "" });
        break;
      case "product":
        onChange({ type, productId: targets?.products[0]?.id ?? "" });
        break;
      case "category":
        onChange({ type, categoryId: targets?.categories[0]?.id ?? "" });
        break;
      case "path":
        onChange({ type, path: "/" });
        break;
      case "url":
        onChange({ type, url: "https://" });
        break;
      case "none":
        onChange({ type });
        break;
    }
  }
  const pages = targets?.pages ?? [];
  const products = targets?.products ?? [];
  const categories = targets?.categories ?? [];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 block text-sm font-medium text-ink">
        {t("content.menus.picker.legend")}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <select
          id={`${id}-type`}
          aria-label={t("content.menus.picker.kind")}
          value={target.type}
          disabled={readOnly}
          onChange={(e) => changeType(e.currentTarget.value as MenuTargetType)}
          className={FIELD}
        >
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {t(`content.menus.target.${ty}`)}
            </option>
          ))}
        </select>
        {target.type === "page" ? (
          <select
            key="page"
            id={`${id}-page`}
            aria-label={t("content.menus.picker.page")}
            value={target.pageId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "page", pageId: e.currentTarget.value })}
            className={FIELD}
          >
            {pages.some((p) => p.id === target.pageId) ? null : (
              <option key="missing" value={target.pageId}>
                {t("content.menus.picker.pageMissing")}
              </option>
            )}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.livePath !== null
                  ? `${p.title} — ${p.livePath}`
                  : t("content.menus.picker.pageNotLive", { title: p.title, path: p.path })}
              </option>
            ))}
          </select>
        ) : target.type === "product" ? (
          <select
            key="product"
            id={`${id}-product`}
            aria-label={t("content.menus.picker.product")}
            value={target.productId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "product", productId: e.currentTarget.value })}
            className={FIELD}
          >
            {products.some((p) => p.id === target.productId) ? null : (
              <option key="missing" value={target.productId}>
                {t("content.menus.picker.productMissing")}
              </option>
            )}
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.livePath ? p.name : t("content.menus.picker.productNotLive", { name: p.name })}
              </option>
            ))}
          </select>
        ) : target.type === "category" ? (
          <select
            key="category"
            id={`${id}-category`}
            aria-label={t("content.menus.picker.category")}
            value={target.categoryId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "category", categoryId: e.currentTarget.value })}
            className={FIELD}
          >
            {categories.some((c) => c.id === target.categoryId) ? null : (
              <option key="missing" value={target.categoryId}>
                {t("content.menus.picker.categoryMissing")}
              </option>
            )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {t("content.menus.picker.categoryOption", {
                  prefix: c.parentId ? "— " : "",
                  name: c.name,
                  count: c.liveProducts,
                })}
              </option>
            ))}
          </select>
        ) : target.type === "path" ? (
          <input
            key="path"
            id={`${id}-path`}
            aria-label={t("content.menus.picker.path")}
            value={target.path}
            maxLength={500}
            readOnly={readOnly}
            spellCheck={false}
            aria-invalid={invalid}
            placeholder={t("content.menus.picker.pathPlaceholder")}
            onChange={(e) => onChange({ type: "path", path: e.currentTarget.value })}
            className={cx(FIELD, "font-mono")}
          />
        ) : target.type === "url" ? (
          <input
            key="url"
            id={`${id}-url`}
            aria-label={t("content.menus.picker.url")}
            value={target.url}
            maxLength={500}
            readOnly={readOnly}
            spellCheck={false}
            aria-invalid={invalid}
            placeholder={t("content.menus.picker.urlPlaceholder")}
            onChange={(e) => onChange({ type: "url", url: e.currentTarget.value })}
            className={cx(FIELD, "font-mono")}
          />
        ) : (
          <p key="none" className="self-center text-sm text-ink-3">
            <span>{t("content.menus.picker.none")}</span>
          </p>
        )}
      </div>
    </fieldset>
  );
}

// --- small controls -----------------------------------------------------------------------------

function TextInput({
  id,
  label,
  value,
  max,
  multiline = false,
  mono = false,
  readOnly,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  multiline?: boolean;
  mono?: boolean;
  readOnly: boolean;
  invalid: true | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      {multiline ? (
        <textarea
          key="multi"
          id={id}
          value={value}
          maxLength={max}
          readOnly={readOnly}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={TEXTAREA}
        />
      ) : (
        <input
          key="single"
          id={id}
          value={value}
          maxLength={max}
          readOnly={readOnly}
          aria-invalid={invalid}
          spellCheck={mono ? false : undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={cx(FIELD, mono && "font-mono")}
        />
      )}
    </Field>
  );
}

function Toggle({
  id,
  label,
  checked,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-ink-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={readOnly}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="size-4 accent-petrol"
      />
      <span>{label}</span>
    </label>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(buttonStyles.secondary, "mt-3")}
    >
      <Icon name="plus" size={15} />
      <span>{label}</span>
    </button>
  );
}

// --- structure preview and warnings --------------------------------------------------------------

function PreviewLink({
  link,
  targets,
  sub = [],
}: {
  link: MenuLink;
  targets: CmsMenuTargetsResponse | null;
  /** The submenu links, listed under the link. */
  sub?: MenuLink[];
}) {
  const t = useT();
  const check = targets ? menuTargetCheck(link.target, targets) : null;
  const href =
    check?.href ??
    (link.target.type === "path"
      ? link.target.path
      : link.target.type === "url"
        ? link.target.url
        : null);
  return (
    <li className={cx("py-1", !link.visible && "text-ink-3 line-through")}>
      <span className="font-medium text-ink">{link.label}</span>
      <span className="ml-2 font-mono text-xs text-ink-3">
        {link.visible
          ? (href ?? t("content.menus.structure.notReady"))
          : t("content.menus.structure.hidden")}
      </span>
      {link.visible && link.newTab ? (
        <span key="newtab" className="ml-2 text-xs text-ink-3">
          {t("content.menus.structure.newTab")}
        </span>
      ) : null}
      {link.visible && check?.problem ? (
        <span key="warn" className="ml-2 text-xs font-medium text-amber-ink">
          {t("content.menus.structure.checkTarget")}
        </span>
      ) : null}
      {sub.length ? (
        <ul key="sub" className="ml-4 border-l border-line pl-3">
          {sub.map((c, j) => (
            <PreviewLink key={`c-${j}`} link={c} targets={targets} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * ML-12c: the `place` of a link (@dream/contracts navLinks/footerLinks: "Header › Products",
 * "Footer › legal › Privacy Policy") in the UI language. Only the fixed words change; the menu
 * labels in it are content. English is the contract text as it is.
 */
// The English words of the contract's `place` (matched, then replaced): codes here, not UI text.
const PLACE_CONTACT = "Header › contact button"; // i18n-ignore: contract place words
const PLACE_BUTTON = "Footer › button"; // i18n-ignore: contract place words
const PLACE_LEGAL = "Footer › legal › "; // i18n-ignore: contract place words
const PLACE_PREFIXES = [
  ["Header › ", "header"], // i18n-ignore: contract place words
  ["Footer › ", "footer"], // i18n-ignore: contract place words
  ["Links without JavaScript › ", "noScript"], // i18n-ignore: contract place words
] as const;

function placeText(place: string, t: Translate): string {
  const S = " › ";
  const w = (k: "header" | "footer" | "noScript" | "contactButton" | "button" | "legal") =>
    t(`content.menus.place.${k}`);
  if (place === PLACE_CONTACT) return `${w("header")}${S}${w("contactButton")}`;
  if (place === PLACE_BUTTON) return `${w("footer")}${S}${w("button")}`;
  if (place.startsWith(PLACE_LEGAL))
    return `${w("footer")}${S}${w("legal")}${S}${place.slice(PLACE_LEGAL.length)}`;
  for (const [prefix, k] of PLACE_PREFIXES)
    if (place.startsWith(prefix)) return `${w(k)}${S}${place.slice(prefix.length)}`;
  return place;
}

function StructurePreview({
  menuKey,
  value,
  targets,
}: {
  menuKey: CmsMenuKey;
  value: MenuValue;
  targets: CmsMenuTargetsResponse | null;
}) {
  const t = useT();
  const links =
    menuKey === BV_NAV_KEY ? navLinks(value as BvNavMenu) : footerLinks(value as BvFooterMenu);
  const problems = targets
    ? links
        .map((l) => ({
          place: placeText(l.place, t),
          check: menuTargetCheck(l.link.target, targets),
        }))
        .filter((p) => p.check.problem)
    : [];
  return (
    <Panel
      id="menu-structure"
      title={t("content.menus.structure.title")}
      description={t("content.menus.structure.description")}
    >
      {problems.length ? (
        <div
          key="problems"
          role="note"
          className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/25"
        >
          <p className="font-medium">
            <span>{t("content.menus.structure.problems", { count: problems.length })}</span>
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p.place}>
                <span>{`${p.place}: ${cmsText(MENU_TARGET_PROBLEMS[p.check.problem as keyof typeof MENU_TARGET_PROBLEMS], t)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {menuKey === BV_NAV_KEY ? (
        <ul key="nav" className="text-sm">
          {(value as BvNavMenu).items.map((item, i) => (
            <PreviewLink key={`p-${i}`} link={item} targets={targets} sub={item.children} />
          ))}
          <PreviewLink key="contact" link={(value as BvNavMenu).contact} targets={targets} />
        </ul>
      ) : (
        <div key="footer" className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          {(value as BvFooterMenu).columns.map((col, i) => (
            <div key={`col-${i}`} className={cx(!col.visible && "opacity-60")}>
              <p className="font-semibold text-ink">
                <span>
                  {col.visible
                    ? col.title
                    : t("content.menus.structure.columnHidden", { title: col.title })}
                </span>
              </p>
              <ul>
                {col.links.map((l, j) => (
                  <PreviewLink key={`l-${j}`} link={l} targets={targets} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// --- the reference conversion (data step) ----------------------------------------------------------

function ReferencePanel({
  menuKey,
  value,
  targets,
  readOnly,
  onChange,
}: {
  menuKey: CmsMenuKey;
  value: MenuValue;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  onChange: (v: MenuValue) => void;
}) {
  const t = useT();
  const headingId = useId();
  if (!targets) return null;
  const plan = menuReferencePlan(menuKey, value, targets);
  return (
    <Panel
      id="menu-references"
      title={t("content.menus.references.title")}
      description={t("content.menus.references.description")}
    >
      {plan.changes.length === 0 ? (
        <p key="none" className="text-sm text-ink-2">
          <span>{t("content.menus.references.none")}</span>
        </p>
      ) : (
        <div key="plan" className="space-y-3" role="group" aria-labelledby={headingId}>
          <p id={headingId} className="text-sm text-ink">
            <span>{t("content.menus.references.count", { count: plan.changes.length })}</span>
          </p>
          <ul className="space-y-1 text-sm">
            {plan.changes.map((c) => (
              <li key={c.path} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">{placeText(c.place, t)}</span>
                <span className="font-mono text-xs text-ink-3">{c.from}</span>
                <span className="text-xs text-ink-3">
                  {t("content.menus.references.change", {
                    kind: kindName(c.to.type, t),
                    name: c.toName,
                  })}
                </span>
              </li>
            ))}
          </ul>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => onChange(plan.content)}
              className={buttonStyles.secondary}
            >
              <Icon name="refresh" size={15} />
              <span>{t("content.menus.references.apply")}</span>
            </button>
          ) : null}
          <p className="text-xs text-ink-3">
            <span>{t("content.menus.references.note")}</span>
          </p>
        </div>
      )}
    </Panel>
  );
}
