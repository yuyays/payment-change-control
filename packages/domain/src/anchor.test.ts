import { describe, expect, it } from "vite-plus/test";
import { anchorClaims } from "./index.js";

const BODY =
  "Please update to ACME Trust, IBAN DE89 3704 0044 0532 0130 00. Call +81 90 1234 5678.";

describe("anchorClaims", () => {
  it("anchors a quote that appears verbatim", () => {
    const { anchored, dropped } = anchorClaims(BODY, [
      { field: "iban", quote: "DE89 3704 0044 0532 0130 00" },
    ]);
    expect(dropped).toHaveLength(0);
    expect(anchored).toHaveLength(1);
    expect(anchored[0]?.citation.start).toBe(BODY.indexOf("DE89"));
  });

  it("drops a quote the model invented", () => {
    const { anchored, dropped } = anchorClaims(BODY, [
      { field: "iban", quote: "DE00 0000 0000 0000 0000 00" },
    ]);
    expect(anchored).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("drops a quote that was paraphrased rather than copied", () => {
    const { anchored } = anchorClaims(BODY, [{ field: "iban", quote: "DE89 3704 0044" }]);
    expect(anchored).toHaveLength(0);
  });

  it("drops a truncated value even when the substring exists", () => {
    const { anchored, dropped } = anchorClaims(BODY, [{ field: "iban", quote: "DE89" }]);
    expect(anchored).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("keeps a checksum-valid IBAN", () => {
    const { anchored } = anchorClaims(BODY, [
      { field: "iban", quote: "DE89 3704 0044 0532 0130 00" },
    ]);
    expect(anchored).toHaveLength(1);
  });

  it("drops an IBAN that fails the mod-97 checksum", () => {
    const body = "Please pay to DE89 3704 0044 0532 0130 01 immediately.";
    const { anchored } = anchorClaims(body, [
      { field: "iban", quote: "DE89 3704 0044 0532 0130 01" },
    ]);
    expect(anchored).toHaveLength(0);
  });

  it("extracts the value from a quote that includes the label", () => {
    const body = "New IBAN: FR14 2004 1010 0505 0001 3M02 606";
    const { anchored, dropped } = anchorClaims(body, [
      { field: "iban", quote: "New IBAN: FR14 2004 1010 0505 0001 3M02 606" },
    ]);
    expect(dropped).toHaveLength(0);
    expect(anchored[0]?.value).toBe("FR14 2004 1010 0505 0001 3M02 606");
    expect(body.slice(anchored[0]?.citation.start, anchored[0]?.citation.end)).toBe(
      "FR14 2004 1010 0505 0001 3M02 606",
    );
  });

  it("extracts a lower-case IBAN from a lower-case quote", () => {
    const body = "new iban: de89 3704 0044 0532 0130 00";
    const { anchored } = anchorClaims(body, [
      { field: "iban", quote: "new iban: de89 3704 0044 0532 0130 00" },
    ]);
    expect(anchored[0]?.value).toBe("de89 3704 0044 0532 0130 00");
  });

  it("still drops a quote with no well-formed value inside it", () => {
    const body = "Our new IBAN is coming next week.";
    const { anchored } = anchorClaims(body, [
      { field: "iban", quote: "Our new IBAN is coming next week." },
    ]);
    expect(anchored).toHaveLength(0);
  });

  it("deduplicates identical claims", () => {
    const quote = "DE89 3704 0044 0532 0130 00";
    const { anchored } = anchorClaims(BODY, [
      { field: "iban", quote },
      { field: "iban", quote },
    ]);
    expect(anchored).toHaveLength(1);
  });

  it("keeps two different fields quoting the same text", () => {
    const quote = "+81 90 1234 5678";
    const { anchored } = anchorClaims(BODY, [
      { field: "callbackPhone", quote },
      { field: "bankName", quote },
    ]);
    expect(anchored).toHaveLength(2);
  });
});
