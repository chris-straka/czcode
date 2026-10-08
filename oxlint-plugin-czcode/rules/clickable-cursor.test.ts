import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("czcode/clickable-cursor", {
  filename: "fixture.tsx",
});

describe("czcode/clickable-cursor", () => {
  rule.valid(
    "allows buttons and links, which get the pointer from the base layer",
    `const el = <><button onClick={go}>Go</button><a href="/x" onClick={go}>x</a></>;`,
  );

  rule.valid(
    "allows a clickable div with a button role",
    `const el = <div role="button" tabIndex={0} onClick={go} />;`,
  );

  rule.valid(
    "allows a cursor class, also inside cn()",
    `const el = <div className={cn("flex", "cursor-pointer")} onClick={go} />;`,
  );

  rule.valid(
    "allows an inline style cursor",
    `const el = <div style={{ cursor: zoom ? "grab" : "zoom-in" }} onClick={go} />;`,
  );

  rule.valid("allows components, which own their cursor", `const el = <Card onClick={go} />;`);

  rule.valid("allows elements without a click handler", `const el = <div className="flex" />;`);

  rule.invalid(
    "reports a clickable waveform canvas without a pointer",
    `const el = <canvas className="h-10 w-full" onClick={seek} />;`,
    (output) => {
      assert.match(output, /pointer cursor/);
    },
  );

  rule.invalid(
    "reports a clickable thumbnail",
    `const el = <img src={src} alt="" onClick={open} />;`,
  );

  rule.invalid(
    "reports a role that is not an action",
    `const el = <div role="region" className="p-2" onClick={open} />;`,
  );
});
