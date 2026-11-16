import { describe, expect, it } from "vite-plus/test";
import { makeReviewerCheck, reviewerSummary } from "./reviewer-check.js";

describe("synthetic reviewer measurement", () => {
  it("uses a real citation for a semantically wrong packet annotation", () => {
    const body = "Our bank account has changed. New IBAN: DE89";
    const check = makeReviewerCheck(body);
    expect(body.slice(check.start, check.end)).toBe(check.quote);
    expect(check.claim).toContain("has not changed");
  });
  it("does not present an empty sample as success", () => {
    expect(reviewerSummary([])).toEqual({
      total: 0,
      misses: 0,
      missRate: null,
      gateWarning: false,
    });
  });
  it("counts first decisions, not retries, and warns at 50%", () => {
    expect(
      reviewerSummary([
        { approverId: "a", decision: "approve" },
        { approverId: "a", decision: "reject" },
        { approverId: "b", decision: "reject" },
      ]),
    ).toEqual({ total: 2, misses: 1, missRate: 0.5, gateWarning: true });
  });
});
