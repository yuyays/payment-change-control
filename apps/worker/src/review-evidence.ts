export interface ReviewEvidence {
  readonly approverId: string;
  /** Distinct citations the approver opened before deciding. */
  readonly citationsOpened: number;
  /** Time between the review packet rendering and the approval click. */
  readonly dwellMs: number;
  readonly at: number;
}

export interface EvidenceSummary {
  readonly approvals: number;
  readonly approvalsWithCitations: number;
  readonly medianDwellMs: number;
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

export function summariseEvidence(evidence: ReadonlyArray<ReviewEvidence>): EvidenceSummary {
  return {
    approvals: evidence.length,
    approvalsWithCitations: evidence.filter((item) => item.citationsOpened > 0).length,
    medianDwellMs: median(evidence.map((item) => item.dwellMs)),
  };
}
