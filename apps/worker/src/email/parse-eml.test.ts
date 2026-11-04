import { describe, expect, it } from "vite-plus/test";
import { EmlParseError, parseEml } from "./parse-eml.js";

describe("parseEml", () => {
  it("reads a plain-text email", () => {
    const parsed = parseEml(
      [
        "From: Billing <billing@acme-industrial.com>",
        "Reply-To: ap@acme-industrial.com",
        "Subject: Bank change",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Please update to DE89 3704 0044 0532 0130 00.",
      ].join("\n"),
    );

    expect(parsed.fromAddress).toBe("billing@acme-industrial.com");
    expect(parsed.replyTo).toBe("ap@acme-industrial.com");
    expect(parsed.subject).toBe("Bank change");
    expect(parsed.rawBody).toContain("DE89 3704 0044");
  });

  it("decodes a base64 body", () => {
    const body = "Please use GB82 WEST 1234 5698 7654 32.";
    const encoded = Buffer.from(body, "utf8").toString("base64");
    const parsed = parseEml(
      [
        "From: billing@acme-industrial.com",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        encoded,
      ].join("\n"),
    );

    expect(parsed.rawBody.trim()).toBe(body);
  });

  it("decodes quoted-printable", () => {
    const parsed = parseEml(
      [
        "From: billing@acme-industrial.com",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "IBAN: FR14 2004 1010 0505 0001 3M02 606 and a soft=",
        " break.",
      ].join("\n"),
    );

    expect(parsed.rawBody).toContain("FR14 2004");
    expect(parsed.rawBody).toContain("soft break");
  });

  it("prefers the text part of multipart/alternative", () => {
    const parsed = parseEml(
      [
        "From: billing@acme-industrial.com",
        'Content-Type: multipart/alternative; boundary="BOUND"',
        "",
        "--BOUND",
        "Content-Type: text/plain",
        "",
        "Plain IBAN: NL91 ABNA 0417 1643 00",
        "--BOUND",
        "Content-Type: text/html",
        "",
        "<p>HTML <b>IBAN</b></p>",
        "--BOUND--",
      ].join("\n"),
    );

    expect(parsed.rawBody).toContain("NL91 ABNA 0417 1643 00");
    expect(parsed.rawBody).not.toContain("<b>");
  });

  it("falls back to stripped HTML when there is no text part", () => {
    const parsed = parseEml(
      [
        "From: billing@acme-industrial.com",
        "Content-Type: text/html",
        "",
        "<html><body><p>New IBAN: DE89 3704 0044 0532 0130 00</p></body></html>",
      ].join("\n"),
    );

    expect(parsed.rawBody).toContain("DE89 3704 0044");
    expect(parsed.rawBody).not.toContain("<p>");
  });

  it("rejects an email with no From", () => {
    expect(() => parseEml("Subject: hi\n\nbody")).toThrow(EmlParseError);
  });

  it("rejects an email with no body", () => {
    expect(() => parseEml("From: a@b.com\n\n")).toThrow(EmlParseError);
  });
});
