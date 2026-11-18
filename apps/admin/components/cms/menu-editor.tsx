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
import { Field, FIELD, TEXTAREA } from "../catalog/parts";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, StatusPill } from "../ui";
import { IconButton, move } from "./field-form";

type Invalid = (path: string) => true | undefined;

export type MenuValue = BvNavMenu | BvFooterMenu;

const TARGET_LABEL: Record<MenuTargetType, string> = {
  page: "CMS page",
  product: "Product",
  category: "Product category",
  path: "Site path or anchor",
  url: "External address",
  none: "Not ready yet (text)",
};

const SOCIAL_LABEL: Record<MenuSocialNetwork, string> = {
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  other: "Other",
};

const newLink = (): MenuLink => ({
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
  const setItems = (items: MenuNavItem[]) => onChange({ ...value, items });
  return (
    <>
      <Panel
        id="menu-items"
        title="Header menu"
        description={`${value.items.length} of at most ${MENU_LIMITS.navItems} items, in this order on the site. Each item may have a submenu.`}
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
                title={`Item ${i + 1}`}
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
                  <span>Submenu of “{item.label}”</span>
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
                          title={`Submenu link ${j + 1}`}
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
                    <span>No submenu: the item is a plain link.</span>
                  </p>
                )}
                {!readOnly ? (
                  <AddButton
                    label="Add submenu link"
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
            label="Add menu item"
            disabled={value.items.length >= MENU_LIMITS.navItems}
            onClick={() => setItems([...value.items, { ...newLink(), children: [] }])}
          />
        ) : null}
      </Panel>

      <Panel
        id="menu-contact"
        title="Contact button"
        description="The button at the right of the header and at the bottom of the phone menu."
      >
        <div className="rounded-xl border border-line">
          <LinkEditor
            path="content.contact"
            title="Button"
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
        title="Links without JavaScript"
        description="Shown on phones and tablets only when JavaScript is off. Real destinations only: a link that is not ready is left out."
      >
        <LinkList
          path="content.noScriptLinks"
          itemTitle="Link"
          links={value.noScriptLinks}
          max={MENU_LIMITS.noScriptLinks}
          targets={targets}
          readOnly={readOnly}
          invalid={invalid}
          onChange={(noScriptLinks) => onChange({ ...value, noScriptLinks })}
        />
      </Panel>

      <Panel id="menu-texts" title="Texts">
        <TextInput
          id="menu-pending-note"
          label="Note on links that are not ready yet"
          value={value.pendingNote}
          max={120}
          readOnly={readOnly}
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
  const contact = value.contact;
  const setContact = (patch: Partial<BvFooterMenu["contact"]>) =>
    onChange({ ...value, contact: { ...contact, ...patch } });
  return (
    <>
      <Panel id="footer-call" title="Headline and button">
        <div className="space-y-4">
          <TextInput
            id="footer-headline"
            label="Headline"
            value={value.headline}
            max={120}
            readOnly={readOnly}
            invalid={invalid("content.headline")}
            onChange={(headline) => onChange({ ...value, headline })}
          />
          <div className="rounded-xl border border-line">
            <LinkEditor
              path="content.cta"
              title="Button"
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
            label="Intro"
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
        title="Contact details"
        description="Keep address, phone and e-mail identical to the company's official details."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              id="footer-contact-title"
              label="Heading"
              value={contact.title}
              max={60}
              readOnly={readOnly}
              invalid={invalid("content.contact.title")}
              onChange={(title) => setContact({ title })}
            />
            <TextInput
              id="footer-contact-company"
              label="Company"
              value={contact.company}
              max={120}
              readOnly={readOnly}
              invalid={invalid("content.contact.company")}
              onChange={(company) => setContact({ company })}
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Address lines</legend>
            <ol className="space-y-2">
              {contact.addressLines.map((line, i) => (
                <li key={`line-${i}`} className="flex items-center gap-2">
                  <input
                    aria-label={`Address line ${i + 1}`}
                    value={line.text}
                    maxLength={120}
                    readOnly={readOnly}
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
                      label={`Remove address line ${i + 1}`}
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
                label="Add address line"
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
                {k === "phone" ? "Phone" : "E-mail"}
              </legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextInput
                  id={`footer-${k}-label`}
                  label="Shown as"
                  value={contact[k].label}
                  max={k === "phone" ? 60 : 120}
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.label`)}
                  onChange={(label) => setContact({ [k]: { ...contact[k], label } })}
                />
                <TextInput
                  id={`footer-${k}-href`}
                  label={k === "phone" ? "Link (tel:)" : "Link (mailto:)"}
                  value={contact[k].href}
                  max={k === "phone" ? 60 : 200}
                  mono
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.href`)}
                  onChange={(href) => setContact({ [k]: { ...contact[k], href } })}
                />
                <TextInput
                  id={`footer-${k}-note`}
                  label="Note"
                  value={contact[k].note}
                  max={80}
                  readOnly={readOnly}
                  invalid={invalid(`content.contact.${k}.note`)}
                  onChange={(note) => setContact({ [k]: { ...contact[k], note } })}
                />
              </div>
              <Toggle
                id={`footer-${k}-visible`}
                label="Shown on the site"
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
        title="Link columns"
        description={`${value.columns.length} of at most ${MENU_LIMITS.footerColumns} columns, in this order on the site.`}
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
                    <span>Column {i + 1}</span>
                  </h3>
                  {!readOnly ? (
                    <div className="flex items-center gap-1">
                      <IconButton
                        label={`Move column ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() =>
                          onChange({ ...value, columns: move(value.columns, i, i - 1) })
                        }
                      >
                        <Icon name="chevron" size={16} className="-rotate-90" />
                      </IconButton>
                      <IconButton
                        label={`Move column ${i + 1} down`}
                        disabled={i === value.columns.length - 1}
                        onClick={() =>
                          onChange({ ...value, columns: move(value.columns, i, i + 1) })
                        }
                      >
                        <Icon name="chevron" size={16} className="rotate-90" />
                      </IconButton>
                      <IconButton
                        label={`Remove column ${i + 1}`}
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
                      label="Heading"
                      value={col.title}
                      max={60}
                      readOnly={readOnly}
                      invalid={invalid(`content.columns.${i}.title`)}
                      onChange={(title) => setCol({ title })}
                    />
                    <Toggle
                      id={`footer-col-${i}-visible`}
                      label="Column shown"
                      checked={col.visible}
                      readOnly={readOnly}
                      onChange={(visible) => setCol({ visible })}
                    />
                  </div>
                  <LinkList
                    path={`content.columns.${i}.links`}
                    itemTitle="Link"
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
            label="Add column"
            disabled={value.columns.length >= MENU_LIMITS.footerColumns}
            onClick={() =>
              onChange({
                ...value,
                columns: [
                  ...value.columns,
                  { title: "New column", visible: true, links: [newLink()] },
                ],
              })
            }
          />
        ) : null}
      </Panel>

      <Panel
        id="footer-social"
        title="Social media"
        description="Shown under the contact details, as text links. None is shown while the list is empty."
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
                    <Field label="Network" htmlFor={`footer-social-${i}-network`}>
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
                            {SOCIAL_LABEL[n]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <TextInput
                      id={`footer-social-${i}-label`}
                      label="Label"
                      value={s.label}
                      max={60}
                      readOnly={readOnly}
                      invalid={invalid(`content.social.${i}.label`)}
                      onChange={(label) => setSocial({ label })}
                    />
                    <TextInput
                      id={`footer-social-${i}-url`}
                      label="Address (https://)"
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
                      label="Shown on the site"
                      checked={s.visible}
                      readOnly={readOnly}
                      onChange={(visible) => setSocial({ visible })}
                    />
                    {!readOnly ? (
                      <div className="flex items-center gap-1">
                        <IconButton
                          label={`Move social link ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() =>
                            onChange({ ...value, social: move(value.social, i, i - 1) })
                          }
                        >
                          <Icon name="chevron" size={16} className="-rotate-90" />
                        </IconButton>
                        <IconButton
                          label={`Move social link ${i + 1} down`}
                          disabled={i === value.social.length - 1}
                          onClick={() =>
                            onChange({ ...value, social: move(value.social, i, i + 1) })
                          }
                        >
                          <Icon name="chevron" size={16} className="rotate-90" />
                        </IconButton>
                        <IconButton
                          label={`Remove social link ${i + 1}`}
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
            <span>No social media links.</span>
          </p>
        )}
        {!readOnly ? (
          <AddButton
            label="Add social link"
            disabled={value.social.length >= MENU_LIMITS.social}
            onClick={() =>
              onChange({
                ...value,
                social: [
                  ...value.social,
                  { network: "linkedin", label: "LinkedIn", url: "https://", visible: true },
                ],
              })
            }
          />
        ) : null}
      </Panel>

      <Panel id="footer-legal" title="Copyright and legal links">
        <div className="space-y-4">
          <TextInput
            id="footer-copyright"
            label="Copyright line"
            value={value.copyright}
            max={200}
            readOnly={readOnly}
            invalid={invalid("content.copyright")}
            onChange={(copyright) => onChange({ ...value, copyright })}
          />
          <LinkList
            path="content.legal"
            itemTitle="Legal link"
            links={value.legal}
            max={MENU_LIMITS.legal}
            targets={targets}
            readOnly={readOnly}
            invalid={invalid}
            onChange={(legal) => onChange({ ...value, legal })}
          />
          <p className="text-xs text-ink-3">
            <span>
              The Privacy Policy link is hidden automatically where the policy is not published.
            </span>
          </p>
          <TextInput
            id="footer-pending-note"
            label="Note on links that are not ready yet"
            value={value.pendingNote}
            max={120}
            readOnly={readOnly}
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
  links: MenuLink[];
  min?: number;
  max: number;
  targets: CmsMenuTargetsResponse | null;
  readOnly: boolean;
  invalid: Invalid;
  onChange: (links: MenuLink[]) => void;
}) {
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
          <span>No links.</span>
        </p>
      )}
      {!readOnly ? (
        <AddButton
          label={`Add ${itemTitle.toLowerCase()}`}
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
              Hidden
            </StatusPill>
          )}
        </h3>
        {!readOnly && (ordered || onRemove) ? (
          <div className="flex items-center gap-1">
            {ordered ? (
              <IconButton
                label={`Move ${title.toLowerCase()} up`}
                disabled={index === 0}
                onClick={() => onMove(index - 1)}
              >
                <Icon name="chevron" size={16} className="-rotate-90" />
              </IconButton>
            ) : null}
            {ordered ? (
              <IconButton
                label={`Move ${title.toLowerCase()} down`}
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              >
                <Icon name="chevron" size={16} className="rotate-90" />
              </IconButton>
            ) : null}
            {onRemove ? (
              <IconButton label={`Remove ${title.toLowerCase()}`} onClick={onRemove}>
                <Icon name="trash" size={16} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <TextInput
          id={`${id}-label`}
          label="Label"
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
            label="Shown on the site"
            checked={link.visible}
            readOnly={readOnly}
            onChange={(visible) => onChange({ visible })}
          />
        )}
        <Toggle
          id={`${id}-newtab`}
          label="Open in a new tab"
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
  if (check.problem) {
    return (
      <p
        key="problem"
        role="note"
        className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/25"
      >
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <span>{MENU_TARGET_PROBLEMS[check.problem]}</span>
      </p>
    );
  }
  return (
    <p key="ok" className="text-xs text-ink-3">
      <span>{statusText(check, target)}</span>
    </p>
  );
}

function statusText(check: ReturnType<typeof menuTargetCheck>, target: MenuTarget): string {
  if (target.type === "none") return "Shown as text with the note on links that are not ready yet.";
  const ref = target.type === "page" || target.type === "product" || target.type === "category";
  return ref
    ? `Opens ${check.href ?? ""} now. Follows the ${target.type}'s address when it changes.`
    : `Opens ${check.href ?? ""} (fixed address).`;
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
  const types = (Object.keys(TARGET_LABEL) as MenuTargetType[]).filter(
    (t) =>
      (allowNone || t !== "none") &&
      (targets || !["page", "product", "category"].includes(t) || t === target.type),
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
      <legend className="mb-1.5 block text-sm font-medium text-ink">Target</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <select
          id={`${id}-type`}
          aria-label="Kind of target"
          value={target.type}
          disabled={readOnly}
          onChange={(e) => changeType(e.currentTarget.value as MenuTargetType)}
          className={FIELD}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
        {target.type === "page" ? (
          <select
            key="page"
            id={`${id}-page`}
            aria-label="Page"
            value={target.pageId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "page", pageId: e.currentTarget.value })}
            className={FIELD}
          >
            {pages.some((p) => p.id === target.pageId) ? null : (
              <option key="missing" value={target.pageId}>
                Page no longer available
              </option>
            )}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.title} — ${p.livePath ?? `${p.path} (not live)`}`}
              </option>
            ))}
          </select>
        ) : target.type === "product" ? (
          <select
            key="product"
            id={`${id}-product`}
            aria-label="Product"
            value={target.productId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "product", productId: e.currentTarget.value })}
            className={FIELD}
          >
            {products.some((p) => p.id === target.productId) ? null : (
              <option key="missing" value={target.productId}>
                Product not available
              </option>
            )}
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.name}${p.livePath ? "" : " (not live)"}`}
              </option>
            ))}
          </select>
        ) : target.type === "category" ? (
          <select
            key="category"
            id={`${id}-category`}
            aria-label="Category"
            value={target.categoryId}
            disabled={readOnly}
            aria-invalid={invalid}
            onChange={(e) => onChange({ type: "category", categoryId: e.currentTarget.value })}
            className={FIELD}
          >
            {categories.some((c) => c.id === target.categoryId) ? null : (
              <option key="missing" value={target.categoryId}>
                Category no longer available
              </option>
            )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.parentId ? "— " : ""}${c.name} (${c.liveProducts} live)`}
              </option>
            ))}
          </select>
        ) : target.type === "path" ? (
          <input
            key="path"
            id={`${id}-path`}
            aria-label="Site path or anchor"
            value={target.path}
            maxLength={500}
            readOnly={readOnly}
            spellCheck={false}
            aria-invalid={invalid}
            placeholder="/products or #services"
            onChange={(e) => onChange({ type: "path", path: e.currentTarget.value })}
            className={cx(FIELD, "font-mono")}
          />
        ) : target.type === "url" ? (
          <input
            key="url"
            id={`${id}-url`}
            aria-label="External address"
            value={target.url}
            maxLength={500}
            readOnly={readOnly}
            spellCheck={false}
            aria-invalid={invalid}
            placeholder="https://, mailto: or tel:"
            onChange={(e) => onChange({ type: "url", url: e.currentTarget.value })}
            className={cx(FIELD, "font-mono")}
          />
        ) : (
          <p key="none" className="self-center text-sm text-ink-3">
            <span>No link yet: shown as text.</span>
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
        {link.visible ? (href ?? "text (not ready yet)") : "hidden"}
      </span>
      {link.visible && link.newTab ? (
        <span key="newtab" className="ml-2 text-xs text-ink-3">
          new tab
        </span>
      ) : null}
      {link.visible && check?.problem ? (
        <span key="warn" className="ml-2 text-xs font-medium text-amber-ink">
          check target
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

function StructurePreview({
  menuKey,
  value,
  targets,
}: {
  menuKey: CmsMenuKey;
  value: MenuValue;
  targets: CmsMenuTargetsResponse | null;
}) {
  const links =
    menuKey === BV_NAV_KEY ? navLinks(value as BvNavMenu) : footerLinks(value as BvFooterMenu);
  const problems = targets
    ? links
        .map((l) => ({ place: l.place, check: menuTargetCheck(l.link.target, targets) }))
        .filter((p) => p.check.problem)
    : [];
  return (
    <Panel
      id="menu-structure"
      title="Structure"
      description="What the site shows with this draft: hidden links struck through, each link with the address it opens now. Use Preview for the real page."
    >
      {problems.length ? (
        <div
          key="problems"
          role="note"
          className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/25"
        >
          <p className="font-medium">
            <span>{`${problems.length} link${problems.length === 1 ? "" : "s"} to check:`}</span>
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p.place}>
                <span>{`${p.place}: ${MENU_TARGET_PROBLEMS[p.check.problem as keyof typeof MENU_TARGET_PROBLEMS]}`}</span>
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
                <span>{col.visible ? col.title : `${col.title} (hidden)`}</span>
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
  const headingId = useId();
  if (!targets) return null;
  const plan = menuReferencePlan(menuKey, value, targets);
  return (
    <Panel
      id="menu-references"
      title="Content references"
      description="Links to pages, products and categories follow their address when a slug changes. This finds fixed site paths that can become such references; every address stays the same."
    >
      {plan.changes.length === 0 ? (
        <p key="none" className="text-sm text-ink-2">
          <span>Every link that can be a content reference already is one.</span>
        </p>
      ) : (
        <div key="plan" className="space-y-3" role="group" aria-labelledby={headingId}>
          <p id={headingId} className="text-sm text-ink">
            <span>{`${plan.changes.length} fixed path${plan.changes.length === 1 ? "" : "s"} can become content references:`}</span>
          </p>
          <ul className="space-y-1 text-sm">
            {plan.changes.map((c) => (
              <li key={c.path} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">{c.place}</span>
                <span className="font-mono text-xs text-ink-3">{c.from}</span>
                <span className="text-xs text-ink-3">{`→ ${c.to.type} “${c.toName}”`}</span>
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
              <span>Use content references in the draft</span>
            </button>
          ) : null}
          <p className="text-xs text-ink-3">
            <span>
              Changes the draft only. Save, preview and publish as usual; the live menu changes when
              you publish.
            </span>
          </p>
        </div>
      )}
    </Panel>
  );
}
