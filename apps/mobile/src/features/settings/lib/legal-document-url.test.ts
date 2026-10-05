import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://cz.ccez.uk/legal",
    "https://cz.ccez.uk/legal/",
    "https://cz.ccez.uk/privacy-policy?source=app",
    "https://cz.ccez.uk/terms-of-service#updates",
    "https://cz.ccez.uk/security-policy",
  ])("allows a configured legal document: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(true);
  });

  it.each([
    "https://cz.ccez.uk/download",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
