import { describe, expect, it } from "vite-plus/test";
import { parseExtraction } from "./schema.js";

describe("parseExtraction", () => {
  it("accepts the claim schema", () => {
    const parsed = parseExtraction('{"claims":[{"field":"iban","quote":"DE89 3704 0044"}]}');
    expect(parsed?.claims).toHaveLength(1);
  });

  it("accepts an empty claim list", () => {
    expect(parseExtraction('{"claims":[]}')?.claims).toHaveLength(0);
  });

  it("unwraps a fenced json block", () => {
    const parsed = parseExtraction('```json\n{"claims":[]}\n```');
    expect(parsed).not.toBeNull();
  });

  it("rejects a response that carries a verdict", () => {
    const parsed = parseExtraction('{"claims":[],"decision":"approve","risk":"low"}');
    expect(parsed).toBeNull();
  });

  it("rejects an extra key inside a claim", () => {
    const parsed = parseExtraction(
      '{"claims":[{"field":"iban","quote":"DE89","confidence":0.99}]}',
    );
    expect(parsed).toBeNull();
  });

  it("rejects an unknown field", () => {
    expect(parseExtraction('{"claims":[{"field":"accountNumber","quote":"123"}]}')).toBeNull();
  });

  it("rejects non-json", () => {
    expect(parseExtraction("Sure! The IBAN is DE89.")).toBeNull();
  });
});
