import { describe, expect, it } from "vite-plus/test";

import { expandPath, imageAttachment } from "./attachments.ts";

describe("imageAttachment", () => {
  it("encodes a PNG as a data URL", () => {
    const attachment = imageAttachment("shot.PNG", new Uint8Array([1, 2, 3]));
    expect(attachment).toEqual({
      type: "image",
      name: "shot.PNG",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,AQID",
    });
  });

  it("refuses files that aren't sendable images", () => {
    expect(imageAttachment("notes.pdf", new Uint8Array(1))).toHaveProperty("error");
    expect(imageAttachment("huge.png", new Uint8Array(11 * 1024 * 1024))).toHaveProperty("error");
  });
});

describe("expandPath", () => {
  it("expands ~ and unquotes paths dropped into the terminal", () => {
    expect(expandPath("~/Desktop/a.png", "/home/c")).toBe("/home/c/Desktop/a.png");
    expect(expandPath("'/tmp/my shot.png' ", "/home/c")).toBe("/tmp/my shot.png");
    expect(expandPath("/tmp/my\\ shot.png", "/home/c")).toBe("/tmp/my shot.png");
  });
});
