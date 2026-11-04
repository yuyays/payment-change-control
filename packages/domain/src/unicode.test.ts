import { describe, expect, it } from "vite-plus/test";
import { domainVerdict } from "./checks.js";
import { decodePunycode, decodePunycodeLabels } from "./unicode.js";

describe("decodePunycode", () => {
  it("decodes the canonical example", () => {
    expect(decodePunycode("bcher-kva")).toBe("bücher");
  });

  it("decodes a punycode label inside a domain", () => {
    expect(decodePunycodeLabels("xn--bcher-kva.example")).toBe("bücher.example");
  });

  it("leaves plain labels alone", () => {
    expect(decodePunycodeLabels("acme-industrial.com")).toBe("acme-industrial.com");
  });

  it("leaves malformed punycode alone instead of throwing", () => {
    expect(decodePunycodeLabels("xn--!!!.com")).toBe("xn--!!!.com");
  });
});

describe("domainVerdict with confusables", () => {
  it("flags a Cyrillic homoglyph as a lookalike, not a match", () => {
    // "аcme-industrial.com" where the first character is Cyrillic а (U+0430).
    expect(domainVerdict("\u0430cme-industrial.com", "acme-industrial.com")).toBe("lookalike");
  });

  it("flags a Greek omicron as a lookalike", () => {
    // "acme-industri\u03b1l.com" where the "a" before "l" is Greek alpha.
    expect(domainVerdict("acme-industri\u03b1l.com", "acme-industrial.com")).toBe("lookalike");
  });

  it("still accepts the exact domain", () => {
    expect(domainVerdict("acme-industrial.com", "acme-industrial.com")).toBe("match");
  });

  it("still accepts a subdomain", () => {
    expect(domainVerdict("mail.acme-industrial.com", "acme-industrial.com")).toBe("match");
  });

  it("still flags the dropped-hyphen variant", () => {
    expect(domainVerdict("acmeindustrial.com", "acme-industrial.com")).toBe("lookalike");
  });

  it("still flags an unrelated domain as a mismatch", () => {
    expect(domainVerdict("acme-industrial.co.jp", "acme-industrial.com")).toBe("mismatch");
  });
});
