// COM-2a: the state rules of the corporate header's menus (submenus, phone menu, pending note).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INITIAL_MENU_STATE, menuReducer, type MenuAction, type MenuState } from "./menu-state.ts";

const run = (...actions: MenuAction[]): MenuState =>
  actions.reduce(menuReducer, INITIAL_MENU_STATE);

describe("menuReducer", () => {
  it("opens one submenu at a time; its button toggles it", () => {
    assert.equal(run({ type: "toggleSubmenu", index: 1 }).openSubmenu, 1);
    assert.equal(
      run({ type: "toggleSubmenu", index: 1 }, { type: "toggleSubmenu", index: 2 }).openSubmenu,
      2,
    );
    assert.equal(
      run({ type: "toggleSubmenu", index: 1 }, { type: "toggleSubmenu", index: 1 }).openSubmenu,
      null,
    );
  });

  it("closes a submenu when focus or the pointer leaves it", () => {
    assert.equal(
      run({ type: "toggleSubmenu", index: 0 }, { type: "closeSubmenu" }).openSubmenu,
      null,
    );
    // Nothing open: the same state object (no re-render).
    assert.equal(menuReducer(INITIAL_MENU_STATE, { type: "closeSubmenu" }), INITIAL_MENU_STATE);
  });

  it("Esc closes the innermost open menu first", () => {
    const both: MenuState = { openSubmenu: 0, mobileOpen: true, notice: false };
    const once = menuReducer(both, { type: "escape" });
    assert.deepEqual(once, { openSubmenu: null, mobileOpen: true, notice: false });
    assert.equal(menuReducer(once, { type: "escape" }).mobileOpen, false);
    assert.equal(menuReducer(INITIAL_MENU_STATE, { type: "escape" }), INITIAL_MENU_STATE);
  });

  it("opening the phone menu closes an open submenu", () => {
    const s = run({ type: "toggleSubmenu", index: 2 }, { type: "openMobile" });
    assert.deepEqual(s, { openSubmenu: null, mobileOpen: true, notice: false });
  });

  it("following a link closes every menu", () => {
    const s = run(
      { type: "openMobile" },
      { type: "toggleSubmenu", index: 1 },
      { type: "navigate" },
    );
    assert.equal(s.mobileOpen, false);
    assert.equal(s.openSubmenu, null);
  });

  it("a window that becomes wide closes the phone menu (the page is never left inert)", () => {
    assert.equal(run({ type: "openMobile" }, { type: "wideScreen" }).mobileOpen, false);
    assert.equal(menuReducer(INITIAL_MENU_STATE, { type: "wideScreen" }), INITIAL_MENU_STATE);
  });

  it("the close button closes the phone menu", () => {
    assert.equal(run({ type: "openMobile" }, { type: "closeMobile" }).mobileOpen, false);
  });

  it("a link whose page is not ready yet shows the note, which then goes away", () => {
    const shown = run({ type: "pending" });
    assert.equal(shown.notice, true);
    assert.equal(menuReducer(shown, { type: "noticeDone" }).notice, false);
    // The note does not close an open menu.
    assert.equal(run({ type: "openMobile" }, { type: "pending" }).mobileOpen, true);
  });
});
