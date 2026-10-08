import { describe, expect, it } from "vite-plus/test";

import { type HoverKeyFacts, hoverKeyAction } from "./threadHoverKeys";

const press = (key: string, overrides: Partial<HoverKeyFacts> = {}): HoverKeyFacts => ({
  key,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  inField: false,
  inInteractive: false,
  hasSelection: false,
  hasTarget: true,
  ...overrides,
});

describe("hoverKeyAction", () => {
  it("maps the keys over a hovered row or card", () => {
    expect(hoverKeyAction(press("o"))).toBe("open");
    expect(hoverKeyAction(press("Enter"))).toBe("open");
    expect(hoverKeyAction(press("e"))).toBe("archive");
    expect(hoverKeyAction(press("s"))).toBe("stop");
    expect(hoverKeyAction(press("D", { code: "KeyD", shiftKey: true }))).toBe("delete");
  });

  it("never deletes on a bare d, which scrolls", () => {
    expect(hoverKeyAction(press("d"))).toBeNull();
  });

  it("deletes by physical key, whatever the layout prints", () => {
    expect(hoverKeyAction(press("Д", { code: "KeyD", shiftKey: true }))).toBe("delete");
  });

  it("does nothing with nothing hovered or focused", () => {
    expect(hoverKeyAction(press("e", { hasTarget: false }))).toBeNull();
  });

  it("leaves typing alone", () => {
    expect(hoverKeyAction(press("e", { inField: true }))).toBeNull();
    expect(hoverKeyAction(press("D", { code: "KeyD", shiftKey: true, inField: true }))).toBeNull();
  });

  it("yields to a live text selection", () => {
    expect(hoverKeyAction(press("e", { hasSelection: true }))).toBeNull();
    expect(
      hoverKeyAction(press("D", { code: "KeyD", shiftKey: true, hasSelection: true })),
    ).toBeNull();
  });

  it("leaves modified keys to the app's shortcuts", () => {
    expect(hoverKeyAction(press("e", { metaKey: true }))).toBeNull();
    expect(hoverKeyAction(press("D", { code: "KeyD", shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(hoverKeyAction(press("E", { code: "KeyE", shiftKey: true }))).toBeNull();
  });

  it("lets a focused button or link handle Enter itself", () => {
    expect(hoverKeyAction(press("Enter", { inInteractive: true }))).toBeNull();
    expect(hoverKeyAction(press("o", { inInteractive: true }))).toBe("open");
  });

  it("ignores key repeat for actions that change things", () => {
    expect(hoverKeyAction(press("e", { repeat: true }))).toBeNull();
    expect(hoverKeyAction(press("D", { code: "KeyD", shiftKey: true, repeat: true }))).toBeNull();
  });
});
