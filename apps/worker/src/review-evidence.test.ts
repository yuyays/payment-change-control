import { describe, expect, it } from "vite-plus/test";
import { summariseEvidence, type ReviewEvidence } from "./review-evidence.js";

const evidence = (
  approverId: string,
  citationsOpened: number,
  dwellMs: number,
): ReviewEvidence => ({ approverId, citationsOpened, dwellMs, at: 0 });

describe("summariseEvidence", () => {
  it("reports zeroes for an empty set", () => {
    expect(summariseEvidence([])).toEqual({
      approvals: 0,
      approvalsWithCitations: 0,
      medianDwellMs: 0,
    });
  });

  it("counts approvals that opened at least one citation", () => {
    const result = summariseEvidence([evidence("clerk", 2, 1000), evidence("controller", 0, 3000)]);
    expect(result.approvalsWithCitations).toBe(1);
  });

  it("takes the middle value for an odd count", () => {
    expect(
      summariseEvidence([
        evidence("a", 1, 10_000),
        evidence("b", 1, 30_000),
        evidence("c", 1, 20_000),
      ]).medianDwellMs,
    ).toBe(20_000);
  });

  it("averages the two middles for an even count", () => {
    expect(
      summariseEvidence([evidence("a", 1, 10_000), evidence("b", 1, 21_000)]).medianDwellMs,
    ).toBe(15_500);
  });
});
