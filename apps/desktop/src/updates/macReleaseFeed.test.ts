import { describe, expect, it } from "vite-plus/test";

import { macBuildNumber, newestMacRelease, parseSha256File } from "./macReleaseFeed.ts";

const release = (tag: string, assets: ReadonlyArray<string>, draft = false) => ({
  tag_name: tag,
  draft,
  assets: assets.map((name) => ({
    name,
    size: 100,
    browser_download_url: `https://example.test/${tag}/${name}`,
  })),
});

const macAssets = (version: string) => [
  `Czcode-${version}-arm64.zip`,
  `Czcode-${version}-arm64.zip.sha256`,
];

describe("macBuildNumber", () => {
  it("reads the CI build number and treats a local build as 0", () => {
    expect(macBuildNumber("0.0.46-mac.57")).toBe(57);
    expect(macBuildNumber("0.0.46")).toBe(0);
    expect(macBuildNumber("0.0.46-nightly.20261008.3")).toBe(0);
  });
});

describe("newestMacRelease", () => {
  it("picks the highest build, whatever order GitHub lists releases in", () => {
    const newest = newestMacRelease([
      release("v0.0.46-mac.9", macAssets("0.0.46-mac.9")),
      release("v0.0.47-mac.12", macAssets("0.0.47-mac.12")),
      release("v0.0.46-mac.11", macAssets("0.0.46-mac.11")),
    ]);
    expect(newest).toEqual({
      version: "0.0.47-mac.12",
      build: 12,
      zipUrl: "https://example.test/v0.0.47-mac.12/Czcode-0.0.47-mac.12-arm64.zip",
      zipSize: 100,
      sha256Url: "https://example.test/v0.0.47-mac.12/Czcode-0.0.47-mac.12-arm64.zip.sha256",
    });
  });

  it("skips drafts, other releases, and builds missing their zip or checksum", () => {
    expect(
      newestMacRelease([
        release("v0.0.46-mac.20", macAssets("0.0.46-mac.20"), true),
        release("v0.0.46-mac.19", ["Czcode-0.0.46-mac.19-arm64.zip"]),
        release("v0.0.46", macAssets("0.0.46")),
        release("v0.0.46-mac.18", macAssets("0.0.46-mac.18")),
      ])?.version,
    ).toBe("0.0.46-mac.18");
    expect(newestMacRelease({ message: "rate limited" })).toBeNull();
  });
});

describe("parseSha256File", () => {
  it("reads shasum output and rejects anything else", () => {
    const digest = "a".repeat(64);
    expect(parseSha256File(`${digest}  Czcode-0.0.46-mac.1-arm64.zip\n`)).toBe(digest);
    expect(parseSha256File("Not Found")).toBeNull();
  });
});
