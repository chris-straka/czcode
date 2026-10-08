/**
 * Generic UI checks that run inside the page (Playwright serializes
 * `collectViolations` into the browser, so it must stay self-contained: no
 * imports, no closures over module scope).
 *
 * Every check walks DOM geometry over all elements instead of naming
 * components, so a new view is covered without writing a test for it. An
 * element that breaks a rule on purpose opts out with
 * `data-ui-check-ignore="<check> ..."` on itself or an ancestor.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Violation {
  readonly check: string;
  readonly message: string;
  /** Stable across runs and viewports, so a known issue can be listed once. */
  readonly key: string;
  readonly boxes: ReadonlyArray<Box>;
}

export interface CheckOptions {
  /** Where the native window buttons sit, in CSS px; null outside the desktop shell. */
  readonly trafficLights: Box | null;
  /** Space every control keeps after the window buttons. */
  readonly trafficLightGap: number;
}

export function collectViolations(options: CheckOptions): Violation[] {
  const INTERACTIVE = [
    "button",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    '[contenteditable="true"]',
    ...[
      "button",
      "link",
      "tab",
      "checkbox",
      "switch",
      "radio",
      "option",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "combobox",
      "slider",
    ].map((role) => `[role="${role}"]`),
  ].join(",");
  // Roles whose text is a label to press, never prose to copy.
  const PRESSABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"]';
  const LAYERS =
    '[data-slot="toast-viewport"] > *, [data-slot="toast-popup"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [data-slot$="popup"], [data-slot$="popover-content"]';
  const SEGMENTED =
    '[role="tablist"], [role="radiogroup"], [role="group"], [data-slot="toggle-group"]';
  const BAR =
    'header, footer, nav, [role="toolbar"], [role="tablist"], [role="menubar"], [role="menu"], [role="listbox"], [data-ui-bar]';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const violations: Violation[] = [];
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (element: Element) => {
    let cached = styles.get(element);
    if (!cached) {
      cached = getComputedStyle(element);
      styles.set(element, cached);
    }
    return cached;
  };

  const ignored = (element: Element, check: string) =>
    element.closest(`[data-ui-check-ignore~="${check}"]`) !== null;

  const describe = (element: Element) => {
    const label =
      element.getAttribute("aria-label") ??
      element.getAttribute("title") ??
      (element as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 40) ??
      "";
    const role = element.getAttribute("role");
    const slot = element.getAttribute("data-slot");
    return `${element.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${slot ? `[slot=${slot}]` : ""}${label ? ` "${label}"` : ""}`;
  };

  const box = (r: { left: number; top: number; right: number; bottom: number }): Box => ({
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.right - r.left),
    height: Math.round(r.bottom - r.top),
  });

  interface Edges {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  const intersect = (a: Edges, b: Edges): Edges | null => {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  };

  const reactProps = (element: Element): Record<string, unknown> | undefined => {
    for (const key of Object.keys(element)) {
      if (key.startsWith("__reactProps$")) {
        return (element as unknown as Record<string, Record<string, unknown>>)[key];
      }
    }
    return undefined;
  };

  /** The part of an element a user can see: clipped by scrollers and the viewport. */
  const visibleEdges = (element: Element): Edges | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    if (style(element).visibility !== "visible") return null;
    let edges: Edges | null = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
    let escaped = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const s = style(node);
      if (Number(s.opacity) < 0.05) return null;
      if ((node as HTMLElement).inert) return null;
      if (node !== element && !escaped && s.display !== "contents") {
        const clipX = s.overflowX !== "visible";
        const clipY = s.overflowY !== "visible";
        if (clipX || clipY) {
          const r = node.getBoundingClientRect();
          edges = intersect(edges, {
            left: clipX ? r.left : -Infinity,
            right: clipX ? r.right : Infinity,
            top: clipY ? r.top : -Infinity,
            bottom: clipY ? r.bottom : Infinity,
          });
          if (!edges) return null;
        }
      }
      // Fixed boxes escape their ancestors' scrollers (approximately: a
      // transformed ancestor would still contain them).
      if (s.position === "fixed") escaped = true;
    }
    edges = intersect(edges, { left: 0, top: 0, right: vw, bottom: vh });
    if (!edges || (edges.right - edges.left) * (edges.bottom - edges.top) < 4) return null;
    return edges;
  };

  const disabled = (element: Element) =>
    (element as HTMLButtonElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true";

  const typing = (element: Element) =>
    element.matches(
      'textarea, select, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="button"], [type="submit"], [type="file"])',
    );

  const hitBy = (x: number, y: number, element: Element) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (hit === element || element.contains(hit));
  };
  const samples = (edges: Edges, inset = 3): Array<[number, number]> => [
    [(edges.left + edges.right) / 2, (edges.top + edges.bottom) / 2],
    [edges.left + inset, edges.top + inset],
    [edges.right - inset, edges.top + inset],
    [edges.left + inset, edges.bottom - inset],
    [edges.right - inset, edges.bottom - inset],
  ];
  /** Not hidden under a dialog or page that covers it. */
  const reachable = (element: Element, edges: Edges) =>
    samples(edges).some(([x, y]) => hitBy(x, y, element));

  // Everything a user can press: the semantic set plus React click handlers.
  // A handler on a wrapper around real controls (a menu, a card's body) is
  // event delegation, not a control of its own.
  const interactive: Array<{ element: Element; edges: Edges; reachable: boolean }> = [];
  for (const element of document.body.querySelectorAll("*")) {
    if (element.closest("svg") && element.tagName.toLowerCase() !== "svg") continue;
    // A tooltip's trigger handles clicks only to close the tooltip.
    const clickable =
      element.matches(INTERACTIVE) ||
      (typeof reactProps(element)?.onClick === "function" &&
        element.getAttribute("data-slot") !== "tooltip-trigger" &&
        element.querySelector(INTERACTIVE) === null);
    if (!clickable) continue;
    if (style(element).pointerEvents === "none") continue;
    const edges = visibleEdges(element);
    if (edges) interactive.push({ element, edges, reachable: reachable(element, edges) });
  }

  // 1. Pointer cursor on everything clickable; button text never selects.
  for (const { element, reachable } of interactive) {
    if (!reachable || disabled(element) || typing(element) || ignored(element, "cursor")) continue;
    const cursor = style(element).cursor;
    if (cursor === "auto" || cursor === "default") {
      violations.push({
        check: "cursor",
        message: `${describe(element)} is clickable but shows the ${cursor} cursor`,
        key: `cursor ${describe(element)}`,
        boxes: [box(element.getBoundingClientRect())],
      });
    }
  }
  for (const { element, reachable } of interactive) {
    if (!reachable || !element.matches(PRESSABLE) || ignored(element, "select")) continue;
    if (element.closest('[contenteditable="true"]')) continue;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim() || !text.parentElement) continue;
      const s = style(text.parentElement);
      const select = s.userSelect || s.webkitUserSelect;
      if (select !== "none") {
        violations.push({
          check: "select",
          message: `${describe(element)} text can be selected (user-select: ${select})`,
          key: `select ${describe(element)}`,
          boxes: [box(element.getBoundingClientRect())],
        });
        break;
      }
    }
  }

  // 2. No two controls in the same layer overlap; a menu or toast covering
  //    the page under it is what it is for.
  const layerOf = (element: Element) => element.closest(LAYERS);
  for (let i = 0; i < interactive.length; i++) {
    const a = interactive[i]!;
    for (let j = i + 1; j < interactive.length; j++) {
      const b = interactive[j]!;
      if (!a.reachable || !b.reachable) continue;
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
      if (layerOf(a.element) !== layerOf(b.element)) continue;
      const overlap = intersect(a.edges, b.edges);
      if (!overlap || overlap.right - overlap.left < 2 || overlap.bottom - overlap.top < 2) {
        continue;
      }
      if (ignored(a.element, "overlap") || ignored(b.element, "overlap")) continue;
      // Only overlaps a user can see: one of the two is on top there.
      const cx = (overlap.left + overlap.right) / 2;
      const cy = (overlap.top + overlap.bottom) / 2;
      if (!hitBy(cx, cy, a.element) && !hitBy(cx, cy, b.element)) continue;
      violations.push({
        check: "overlap",
        message: `${describe(a.element)} overlaps ${describe(b.element)}`,
        key: `overlap ${describe(a.element)} / ${describe(b.element)}`,
        boxes: [box(a.edges), box(b.edges)],
      });
    }
  }

  // 3. Icons don't sit on top of other icons or text (53.png).
  // Seen means a hit test lands on the picture or the control wrapping it.
  const shows = (x: number, y: number, element: Element) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (element.contains(hit)) return true;
    let owner: Element | null = element.parentElement;
    for (let depth = 0; owner && depth < 3; depth++, owner = owner.parentElement) {
      if (owner === hit) return true;
    }
    return false;
  };
  const graphics: Array<{ element: Element; edges: Edges }> = [];
  for (const element of document.body.querySelectorAll("svg, img")) {
    if (element.parentElement?.closest("svg")) continue;
    const edges = visibleEdges(element);
    if (edges && samples(edges, 1).some(([x, y]) => shows(x, y, element))) {
      graphics.push({ element, edges });
    }
  }
  for (let i = 0; i < graphics.length; i++) {
    const a = graphics[i]!;
    for (let j = i + 1; j < graphics.length; j++) {
      const b = graphics[j]!;
      const overlap = intersect(a.edges, b.edges);
      if (!overlap || overlap.right - overlap.left < 3 || overlap.bottom - overlap.top < 3) {
        continue;
      }
      if (ignored(a.element, "overlap") || ignored(b.element, "overlap")) continue;
      // A picture that fills a frame (an avatar, a swatch) can carry a badge;
      // two icons of similar size stacked on each other cannot.
      const cx = (overlap.left + overlap.right) / 2;
      const cy = (overlap.top + overlap.bottom) / 2;
      if (!shows(cx, cy, a.element) && !shows(cx, cy, b.element)) continue;
      const areaA = (a.edges.right - a.edges.left) * (a.edges.bottom - a.edges.top);
      const areaB = (b.edges.right - b.edges.left) * (b.edges.bottom - b.edges.top);
      if (Math.max(areaA, areaB) > 4 * Math.min(areaA, areaB)) continue;
      violations.push({
        check: "icon-overlap",
        message: `${describe(a.element)} overlaps ${describe(b.element)}`,
        key: `icon-overlap ${describe(a.element.parentElement ?? a.element)}`,
        boxes: [box(a.edges), box(b.edges)],
      });
    }
  }

  // 3b. Icons and their badges don't sit on a drawn edge: a border, a ring
  //     or an outline (53.png, a sun badge on a selected swatch's ring).
  const transparent = (color: string) => /rgba\([^)]*,\s*0\)|transparent/.test(color);
  const edgeBands = (element: Element): Array<{ inner: number; outer: number }> => {
    const s = style(element);
    const bands: Array<{ inner: number; outer: number }> = [];
    const border = parseFloat(s.borderTopWidth) || 0;
    if (border > 0 && s.borderTopStyle !== "none" && !transparent(s.borderTopColor)) {
      bands.push({ inner: -border, outer: 0 });
    }
    // Rings are shadows with no blur and a spread; soft shadows aren't edges.
    for (const shadow of s.boxShadow === "none" ? [] : s.boxShadow.split(/,(?![^(]*\))/)) {
      if (transparent(shadow)) continue;
      const lengths =
        shadow
          .replace(/rgba?\([^)]*\)/, "")
          .match(/-?[\d.]+px/g)
          ?.map(parseFloat) ?? [];
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
      if (x !== 0 || y !== 0 || blur !== 0 || spread <= 0) continue;
      bands.push(
        shadow.includes("inset") ? { inner: -spread, outer: 0 } : { inner: 0, outer: spread },
      );
    }
    return bands;
  };
  const bordered = [...document.body.querySelectorAll("*")].filter(
    (element) => edgeBands(element).length > 0 && visibleEdges(element) !== null,
  );
  for (const graphic of graphics) {
    if (graphic.element.tagName.toLowerCase() !== "svg") continue;
    if (ignored(graphic.element, "overlap")) continue;
    // A badge is the icon's positioned wrapper; a plain icon is just itself.
    let chip: Element = graphic.element;
    let node = graphic.element.parentElement;
    for (let depth = 0; node && depth < 2; depth++, node = node.parentElement) {
      if (style(node).position === "absolute") {
        chip = node;
        break;
      }
    }
    const c = chip.getBoundingClientRect();
    // Only edges drawn by the icon's own control: a close relative, not
    // something elsewhere on the page (or hidden under a dialog).
    const near: Element[] = [];
    for (
      let node = chip.parentElement, depth = 0;
      node && depth < 4;
      node = node.parentElement, depth++
    ) {
      near.push(node);
    }
    for (const element of bordered) {
      if (element.contains(chip) || chip.contains(element)) continue;
      if (!near.some((ancestor) => ancestor.contains(element))) continue;
      const r = element.getBoundingClientRect();
      if (r.width < c.width * 2 || r.height < c.height * 2) continue;
      const round = (parseFloat(style(element).borderTopLeftRadius) || 0) >= r.width / 2 - 1;
      const crosses = edgeBands(element).some(({ inner, outer }) => {
        if (round) {
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const near = Math.hypot(
            Math.max(c.left, Math.min(cx, c.right)) - cx,
            Math.max(c.top, Math.min(cy, c.bottom)) - cy,
          );
          const far = Math.max(
            ...[c.left, c.right].flatMap((x) =>
              [c.top, c.bottom].map((y) => Math.hypot(x - cx, y - cy)),
            ),
          );
          const edge = r.width / 2;
          return near <= edge + outer && far >= edge + inner;
        }
        const outerBox = {
          left: r.left - outer,
          top: r.top - outer,
          right: r.right + outer,
          bottom: r.bottom + outer,
        };
        const inside =
          c.left >= r.left - inner &&
          c.right <= r.right + inner &&
          c.top >= r.top - inner &&
          c.bottom <= r.bottom + inner;
        const outside = intersect(c, outerBox) === null;
        return !inside && !outside;
      });
      if (!crosses) continue;
      violations.push({
        check: "icon-overlap",
        message: `${describe(chip)} sits on the edge of ${describe(element)}`,
        key: `icon-edge ${describe(element.closest(INTERACTIVE) ?? element)}`,
        boxes: [box(c), box(r)],
      });
      break;
    }
  }

  // 4. Text stays inside its box: no overflow, no clipping without an ellipsis.
  const truncates = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const s = style(node);
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") return true;
      if (s.overflowX !== "visible" || s.display === "block") break;
    }
    return false;
  };
  const range = document.createRange();
  for (const element of document.body.querySelectorAll("*")) {
    if (element.closest("svg, script, style, noscript, [contenteditable='true']")) continue;
    let textEdges: Edges | null = null;
    for (const child of element.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      range.selectNodeContents(child);
      const r = range.getBoundingClientRect();
      if (r.width < 1) continue;
      textEdges = textEdges
        ? {
            left: Math.min(textEdges.left, r.left),
            top: Math.min(textEdges.top, r.top),
            right: Math.max(textEdges.right, r.right),
            bottom: Math.max(textEdges.bottom, r.bottom),
          }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    if (!textEdges || ignored(element, "text")) continue;
    if (!visibleEdges(element) || truncates(element)) continue;
    const fontSize = parseFloat(style(element).fontSize) || 14;
    // Glyph boxes legitimately poke past a tight line-height.
    const slackY = Math.max(2, fontSize * 0.35);
    const escapes = (outer: DOMRect, axis: "x" | "y") =>
      axis === "x"
        ? textEdges!.left < outer.left - 1 || textEdges!.right > outer.right + 1
        : textEdges!.top < outer.top - slackY || textEdges!.bottom > outer.bottom + slackY;
    const own = element.getBoundingClientRect();
    if (style(element).display !== "inline" && escapes(own, "x")) {
      violations.push({
        check: "text-overflow",
        message: `text of ${describe(element)} runs out of its box`,
        key: `text-overflow ${describe(element)}`,
        boxes: [box(own), box(textEdges)],
      });
      continue;
    }
    // Clipped by an ancestor that hides overflow and can't scroll to it.
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const s = style(node);
      if (s.position === "fixed") break;
      const hidesX = s.overflowX === "hidden" || s.overflowX === "clip";
      const hidesY = s.overflowY === "hidden" || s.overflowY === "clip";
      const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY);
      const outer = node.getBoundingClientRect();
      const clipped = (hidesX && escapes(outer, "x")) || (hidesY && escapes(outer, "y"));
      if (clipped) {
        violations.push({
          check: "text-clipped",
          message: `text of ${describe(element)} is cut off by ${describe(node)}`,
          key: `text-clipped ${describe(element)}`,
          boxes: [box(outer), box(textEdges)],
        });
        break;
      }
      if (scrolls) break;
    }
  }

  // 5. One bar never offers the same choice twice (45.png).
  const normalized = (element: Element) =>
    (element.getAttribute("aria-label") ?? (element as HTMLElement).innerText ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[.…!?]+$/, "");
  const bars = new Map<Element, Element[]>();
  for (const { element } of interactive) {
    if (!element.matches(PRESSABLE)) continue;
    const bar = element.parentElement?.closest(BAR) ?? null;
    if (!bar) continue;
    const list = bars.get(bar) ?? [];
    list.push(element);
    bars.set(bar, list);
  }
  for (const [bar, buttons] of bars) {
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const a = normalized(buttons[i]!);
        const b = normalized(buttons[j]!);
        if (!a || !b) continue;
        if (ignored(buttons[i]!, "duplicate") || ignored(buttons[j]!, "duplicate")) continue;
        const [short, long] = a.length <= b.length ? [a, b] : [b, a];
        const same =
          short === long ||
          (short.split(" ").length >= 2 &&
            /^[ ,:(—-]/.test(long.slice(short.length)) &&
            long.startsWith(short));
        if (!same) continue;
        violations.push({
          check: "duplicate",
          message: `${describe(bar)} has "${a}" and "${b}"`,
          key: `duplicate "${short}" in ${bar.tagName.toLowerCase()}`,
          boxes: [
            box(buttons[i]!.getBoundingClientRect()),
            box(buttons[j]!.getBoundingClientRect()),
          ],
        });
      }
    }
  }

  // 6. Toasts, menus, popovers and dialogs stay on screen, and every control
  //    in them takes clicks (51.png).
  for (const layer of document.querySelectorAll(LAYERS)) {
    if (ignored(layer, "layer")) continue;
    const r = layer.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || style(layer).visibility !== "visible") continue;
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
      violations.push({
        check: "offscreen",
        message: `${describe(layer)} runs off the screen`,
        key: `offscreen ${describe(layer)}`,
        boxes: [box(r)],
      });
    }
  }
  for (const { element, edges } of interactive) {
    if (!element.closest(LAYERS) || disabled(element) || ignored(element, "layer")) continue;
    const cx = (edges.left + edges.right) / 2;
    const cy = (edges.top + edges.bottom) / 2;
    const hit = document.elementFromPoint(cx, cy);
    // Under another toast or menu is stacking; under the page's own chrome
    // (a title bar, a header) is a control nobody can click.
    if (!hitBy(cx, cy, element) && !(hit && layerOf(hit) && layerOf(hit) !== layerOf(element))) {
      violations.push({
        check: "covered",
        message: `${describe(element)} is under ${hit ? describe(hit) : "nothing"}`,
        key: `covered ${describe(element)}`,
        boxes: [box(edges)],
      });
    }
  }

  // 7. Desktop title bar: nothing clickable under the window buttons or inside
  //    a drag region unless it opts out with no-drag.
  if (options.trafficLights) {
    const lights = options.trafficLights;
    const reserved: Edges = {
      left: lights.x,
      top: lights.y,
      right: lights.x + lights.width + options.trafficLightGap,
      bottom: lights.y + lights.height,
    };
    for (const { element, edges } of interactive) {
      if (!intersect(edges, reserved) || ignored(element, "titlebar")) continue;
      violations.push({
        check: "traffic-lights",
        message: `${describe(element)} sits within ${options.trafficLightGap}px of the window buttons`,
        key: `traffic-lights ${describe(element)}`,
        boxes: [box(edges), lights],
      });
    }
  }
  const region = (element: Element) =>
    style(element).getPropertyValue("-webkit-app-region") ||
    style(element).getPropertyValue("app-region");
  const drag: Edges[] = [];
  const noDrag: Edges[] = [];
  for (const element of document.body.querySelectorAll("*")) {
    const value = region(element);
    if (value !== "drag" && value !== "no-drag") continue;
    const edges = visibleEdges(element);
    if (edges) (value === "drag" ? drag : noDrag).push(edges);
  }
  if (drag.length > 0) {
    const draggable = (x: number, y: number) => {
      const inside = (e: Edges) => x >= e.left && x <= e.right && y >= e.top && y <= e.bottom;
      return drag.some(inside) && !noDrag.some(inside);
    };
    for (const { element, edges, reachable } of interactive) {
      if (!reachable || ignored(element, "titlebar")) continue;
      if (!samples(edges).some(([x, y]) => draggable(x, y))) continue;
      violations.push({
        check: "drag-region",
        message: `${describe(element)} is inside the title bar drag region, so clicks drag the window`,
        key: `drag-region ${describe(element)}`,
        boxes: [box(edges)],
      });
    }
  }

  // 8. Even spacing between neighbouring header controls.
  for (const header of document.querySelectorAll("header, [data-ui-bar]")) {
    if (ignored(header, "spacing")) continue;
    const controls: Edges[] = [];
    const groups = new Map<Element, Edges>();
    for (const { element, edges, reachable } of interactive) {
      if (!reachable || !header.contains(element)) continue;
      if (interactive.some((o) => o.element !== element && o.element.contains(element))) continue;
      // Segments of one control (tabs, toggle groups) count as one.
      const group = element.parentElement?.closest(SEGMENTED);
      if (group && header.contains(group)) {
        const prev = groups.get(group);
        groups.set(
          group,
          prev
            ? {
                left: Math.min(prev.left, edges.left),
                top: Math.min(prev.top, edges.top),
                right: Math.max(prev.right, edges.right),
                bottom: Math.max(prev.bottom, edges.bottom),
              }
            : { ...edges },
        );
        continue;
      }
      controls.push(edges);
    }
    controls.push(...groups.values());
    // Rows: controls whose vertical centres line up.
    const rows: Edges[][] = [];
    for (const edges of controls) {
      const cy = (edges.top + edges.bottom) / 2;
      const row = rows.find((r) => Math.abs((r[0]!.top + r[0]!.bottom) / 2 - cy) < 6);
      if (row) row.push(edges);
      else rows.push([edges]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.left - b.left);
      const gaps = row.slice(1).map((edges, i) => Math.round(edges.left - row[i]!.right));
      // A cluster is a run of controls closer than 24px; its gaps must match.
      let start = 0;
      for (let i = 0; i <= gaps.length; i++) {
        if (i < gaps.length && gaps[i]! < 24) continue;
        const cluster = gaps.slice(start, i);
        const touching = cluster.findIndex((gap) => gap < 2);
        if (touching !== -1) {
          violations.push({
            check: "spacing",
            message: `two controls in ${describe(header)} touch (${cluster[touching]}px apart)`,
            key: `spacing touching ${describe(header)}`,
            boxes: [box(row[start + touching]!), box(row[start + touching + 1]!)],
          });
        } else if (cluster.length > 1 && Math.max(...cluster) - Math.min(...cluster) > 2) {
          violations.push({
            check: "spacing",
            message: `uneven gaps between controls in ${describe(header)}: ${cluster.join(", ")}px`,
            key: `spacing uneven ${describe(header)}`,
            boxes: row.slice(start, i + 1).map(box),
          });
        }
        start = i + 1;
      }
    }
  }

  // The same element found by several passes is reported once per check.
  const seen = new Set<string>();
  return violations.filter((v) => {
    const id = `${v.key} ${JSON.stringify(v.boxes)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Outlines the offending boxes with numbered labels, for the failure screenshot. */
export function drawViolations(violations: ReadonlyArray<Violation>): void {
  const layer = document.createElement("div");
  layer.setAttribute("data-ui-check-overlay", "");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  violations.forEach((violation, index) => {
    for (const b of violation.boxes) {
      const outline = document.createElement("div");
      outline.style.cssText = `position:fixed;left:${b.x - 1}px;top:${b.y - 1}px;width:${b.width + 2}px;height:${b.height + 2}px;outline:2px solid #ff2d55;background:rgba(255,45,85,.12)`;
      const label = document.createElement("span");
      label.textContent = String(index + 1);
      label.style.cssText =
        "position:absolute;left:-2px;top:-14px;font:600 10px/12px system-ui;background:#ff2d55;color:#fff;padding:0 3px;border-radius:3px";
      outline.append(label);
      layer.append(outline);
    }
  });
  document.body.append(layer);
}

/** Paints macOS window buttons where Electron puts them, so desktop shots read true. */
export function drawTrafficLights(lights: Box): void {
  const layer = document.createElement("div");
  layer.setAttribute("data-ui-check-overlay", "");
  layer.style.cssText = `position:fixed;left:${lights.x}px;top:${lights.y}px;display:flex;gap:${(lights.width - 3 * lights.height) / 2}px;pointer-events:none;z-index:2147483646`;
  for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
    const dot = document.createElement("span");
    dot.style.cssText = `width:${lights.height}px;height:${lights.height}px;border-radius:50%;background:${color}`;
    layer.append(dot);
  }
  document.body.append(layer);
}
