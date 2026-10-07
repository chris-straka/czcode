import { describe, expect, it } from "vite-plus/test";

import { parseAppleScriptData } from "./clipboard.ts";

describe("parseAppleScriptData", () => {
  it("reads the PNG bytes AppleScript prints for a clipboard image", () => {
    expect(parseAppleScriptData("«data PNGf89504E47»\n")).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("returns null for text on the clipboard", () => {
    expect(parseAppleScriptData("hello")).toBe(null);
  });
});
