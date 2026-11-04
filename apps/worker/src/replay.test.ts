import { describe, expect, it } from "vite-plus/test";
import { diffClaims, claimKey } from "./replay.js";
import type { Claim } from "@pcc/domain";

const claim = (field: Claim["citation"]["field"], value: string): Claim => ({
  field,
  value,
  citation: { field, quote: value, start: 0, end: value.length },
});

describe("diffClaims", () => {
  it("normalises whitespace and case", () => {
    expect(claimKey(claim("iban", "de89 3704"))).toBe("iban:DE893704");
  });

  it("reports nothing when the sets match", () => {
    const before = [claim("iban", "DE89 3704")];
    const after = [claim("iban", "de89 3704 ")];
    expect(diffClaims(before, after)).toEqual({ added: [], removed: [] });
  });

  it("reports a newly extracted claim", () => {
    const before: Claim[] = [];
    const after = [claim("callbackPhone", "+81 90 1234 5678")];
    expect(diffClaims(before, after).added).toEqual(["callbackPhone:+819012345678"]);
  });

  it("reports a claim the new model no longer finds", () => {
    const before = [claim("iban", "DE89 3704"), claim("callbackPhone", "+81 3 5555 0100")];
    const after = [claim("iban", "DE89 3704")];
    expect(diffClaims(before, after).removed).toEqual(["callbackPhone:+81355550100"]);
  });
});
