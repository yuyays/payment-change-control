/** Synthetic packet annotation, never an extraction or a payment decision input. */
export interface ReviewerCheck {
  readonly claim: string;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}
export interface ReviewerDecision {
  readonly approverId: string;
  readonly decision: "approve" | "reject";
}
export function makeReviewerCheck(rawBody: string): ReviewerCheck {
  return {
    claim: "The supplier says its bank account has not changed.",
    quote: rawBody,
    start: 0,
    end: rawBody.length,
  };
}
/** First decision per distinct reviewer only. No decisions is not a 0% miss rate. */
export function reviewerSummary(decisions: ReadonlyArray<ReviewerDecision>) {
  const unique = [...new Map([...decisions].reverse().map((d) => [d.approverId, d])).values()];
  const misses = unique.filter((d) => d.decision === "approve").length;
  const total = unique.length;
  const missRate = total === 0 ? null : misses / total;
  return { total, misses, missRate, gateWarning: missRate !== null && missRate >= 0.5 };
}
