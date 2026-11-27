/**
 * COM-2a: the state of the corporate header's menus, as a pure reducer the header component uses
 * (components/site-header.tsx) and `node --test` checks.
 *
 *  - Wide screens: at most one submenu is open. Its button toggles it; Esc, focus leaving it, the
 *    pointer leaving it or following one of its links closes it.
 *  - Phones and tablets: the menu button opens the full-screen menu (a modal dialog); its close
 *    button, Esc, following a link or the window becoming wide closes it. An open submenu of the
 *    wide bar is closed when the phone menu opens (only one menu at a time).
 *  - A link whose page is not ready yet (no href) shows the pending note for a moment.
 *
 * Pure (no React, no `@/` imports) so `node --test` runs it as is.
 */

export interface MenuState {
  /** Index of the open submenu of the wide bar, null when none is open. */
  openSubmenu: number | null;
  /** Whether the phone menu (dialog) is open. */
  mobileOpen: boolean;
  /** Whether the pending note is shown (a link whose page is not ready yet was followed). */
  notice: boolean;
}

export type MenuAction =
  | { type: "toggleSubmenu"; index: number }
  | { type: "closeSubmenu" }
  | { type: "openMobile" }
  | { type: "closeMobile" }
  | { type: "escape" }
  | { type: "navigate" }
  | { type: "wideScreen" }
  | { type: "pending" }
  | { type: "noticeDone" };

export const INITIAL_MENU_STATE: MenuState = {
  openSubmenu: null,
  mobileOpen: false,
  notice: false,
};

/** The width (px) from which the bar shows its menus inline (Tailwind `lg`). */
export const WIDE_MIN_PX = 1024;

/** How long the pending note stays (ms). */
export const NOTICE_MS = 2600;

export function menuReducer(state: MenuState, action: MenuAction): MenuState {
  switch (action.type) {
    case "toggleSubmenu":
      return {
        ...state,
        openSubmenu: state.openSubmenu === action.index ? null : action.index,
      };
    case "closeSubmenu":
      return state.openSubmenu === null ? state : { ...state, openSubmenu: null };
    case "openMobile":
      return { ...state, mobileOpen: true, openSubmenu: null };
    case "closeMobile":
      return state.mobileOpen ? { ...state, mobileOpen: false } : state;
    case "escape":
      // The innermost open thing closes first: a submenu, else the phone menu.
      if (state.openSubmenu !== null) return { ...state, openSubmenu: null };
      return state.mobileOpen ? { ...state, mobileOpen: false } : state;
    case "navigate":
      return { ...state, openSubmenu: null, mobileOpen: false };
    case "wideScreen":
      return state.mobileOpen ? { ...state, mobileOpen: false } : state;
    case "pending":
      return { ...state, notice: true };
    case "noticeDone":
      return state.notice ? { ...state, notice: false } : state;
  }
}
