import { defineRule } from "@oxlint/plugins";

const INTRINSIC_ELEMENT_PATTERN = /^[a-z]/u;

// These show the pointer from the base layer in apps/web/src/index.css.
const POINTER_ELEMENTS = new Set(["a", "button", "label", "option", "select", "summary"]);
const POINTER_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "switch",
  "tab",
]);
// Typing targets keep the text cursor.
const TEXT_ELEMENTS = new Set(["input", "textarea"]);
// A cursor-* class, or a cursor key in an inline style.
const CURSOR_CLASS_PATTERN = /(^|[\s"'`:{,])cursor(-|\s*:)/u;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require clickable intrinsic elements to show a pointer: a button role or a cursor-* class.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const element = node.name.name;
        if (!INTRINSIC_ELEMENT_PATTERN.test(element)) return;
        if (POINTER_ELEMENTS.has(element) || TEXT_ELEMENTS.has(element)) return;

        let onClick: (typeof node.attributes)[number] | null = null;
        for (const attribute of node.attributes) {
          // A spread may carry role or className; trust it.
          if (attribute.type === "JSXSpreadAttribute") return;
          if (attribute.name.type !== "JSXIdentifier") continue;
          const name = attribute.name.name;
          if (name === "onClick") onClick = attribute;
          if (name === "role" && attribute.value?.type === "Literal") {
            if (POINTER_ROLES.has(String(attribute.value.value))) return;
          }
          if ((name === "className" || name === "style") && attribute.value) {
            const text = context.sourceCode.getText(attribute.value);
            if (CURSOR_CLASS_PATTERN.test(text)) return;
          }
        }
        if (!onClick) return;
        context.report({
          node: onClick,
          message:
            'Clickable elements show the pointer cursor. Use a <button>, add role="button", or add a cursor-* class (cursor-pointer, or cursor-default when the click is not an action).',
        });
      },
    };
  },
});
