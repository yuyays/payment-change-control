import { approve, evaluate, type ChangeRequest } from "@pcc/domain";
import type { Extractor } from "../extraction/types.js";
import { CASES } from "./cases.js";

export const EVAL_NOW = Date.UTC(2026, 10, 1);
const HOUR = 3_600_000;

const APPROVERS = [
  { actor: "human" as const, approverId: "clerk", at: EVAL_NOW + 72 * HOUR },
  { actor: "human" as const, approverId: "controller", at: EVAL_NOW + 72 * HOUR },
];

const compact = (value: string): string => value.replace(/\s+/g, "").toUpperCase();
const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

export interface Row {
  readonly id: string;
  readonly category: string;
  readonly outcome: string;
  readonly approvable: boolean;
  readonly blocking: number;
  readonly claims: number;
  readonly dropped: number;
  readonly citationsValid: boolean;
  readonly error: boolean;
  readonly ibanRecalled: boolean | null;
}

export interface Metrics {
  readonly cases: number;
  readonly fraudEscapes: number;
  readonly fraudTotal: number;
  readonly autoApprovals: number;
  readonly citationFailures: number;
  readonly droppedClaims: number;
  readonly errors: number;
  readonly recallHits: number;
  readonly recallTotal: number;
  readonly legitApprovable: number;
  readonly legitTotal: number;
  readonly hardApprovable: number;
  readonly hardTotal: number;
}

export interface EvalRun {
  readonly rows: ReadonlyArray<Row>;
  readonly metrics: Metrics;
  readonly extractor: string;
}

export async function runCases(extractor: Extractor): Promise<EvalRun> {
  const rows: Row[] = [];

  for (const testCase of CASES) {
    let extracted;
    try {
      extracted = await extractor.extract(testCase.email);
    } catch (error) {
      rows.push({
        id: testCase.id,
        category: testCase.category,
        outcome: "error",
        approvable: false,
        blocking: 0,
        claims: 0,
        dropped: 0,
        citationsValid: true,
        error: true,
        ibanRecalled: testCase.expectedIban === undefined ? null : false,
      });
      void error;
      continue;
    }
    const request: ChangeRequest = {
      id: testCase.id,
      vendorId: testCase.vendor.id,
      receivedAt: EVAL_NOW,
      rawBody: testCase.email.rawBody,
      extraction: extracted.extraction,
    };

    const evaluation = evaluate(request, testCase.vendor, EVAL_NOW + HOUR);
    const approvable = approve(evaluation, APPROVERS, EVAL_NOW + 72 * HOUR).ok;
    const claims = extracted.extraction.claims;

    rows.push({
      id: testCase.id,
      category: testCase.category,
      outcome: evaluation.outcome,
      approvable,
      blocking: evaluation.reasons.filter((reason) => reason.blocking).length,
      claims: claims.length,
      dropped: extracted.dropped.length,
      error: false,
      citationsValid: claims.every(
        (claim) =>
          testCase.email.rawBody.slice(claim.citation.start, claim.citation.end) ===
          claim.citation.quote,
      ),
      ibanRecalled:
        testCase.expectedIban === undefined
          ? null
          : claims.some(
              (claim) =>
                claim.field === "iban" &&
                compact(claim.value) === compact(testCase.expectedIban ?? ""),
            ),
    });
  }

  const of = (category: string) => rows.filter((row) => row.category === category);
  const fraud = of("fraud");
  const legit = of("legit");
  const hard = of("hard_negative");
  const recall = rows.filter((row) => row.ibanRecalled !== null);

  return {
    rows,
    extractor: extractor.name,
    metrics: {
      cases: rows.length,
      fraudEscapes: fraud.filter((row) => row.approvable).length,
      fraudTotal: fraud.length,
      autoApprovals: rows.filter((row) => row.outcome === "approve").length,
      citationFailures: rows.filter((row) => !row.citationsValid).length,
      droppedClaims: rows.reduce((sum, row) => sum + row.dropped, 0),
      errors: rows.filter((row) => row.error).length,
      recallHits: recall.filter((row) => row.ibanRecalled === true).length,
      recallTotal: recall.length,
      legitApprovable: legit.filter((row) => row.approvable).length,
      legitTotal: legit.length,
      hardApprovable: hard.filter((row) => row.approvable).length,
      hardTotal: hard.length,
    },
  };
}

export function formatReport(run: EvalRun): string {
  const { rows, metrics } = run;

  const table = rows
    .map(
      (row) =>
        `${row.id.padEnd(26)} ${row.category.padEnd(14)} ${row.outcome.padEnd(9)} ` +
        `${row.approvable ? "approvable" : "blocked   "} claims=${row.claims} blocking=${row.blocking}`,
    )
    .join("\n");

  return [
    "",
    `extractor: ${run.extractor}`,
    "",
    table,
    "",
    "── metrics ────────────────────────────────────────",
    `cases                ${metrics.cases}`,
    `fraud escapes        ${metrics.fraudEscapes} / ${metrics.fraudTotal}   (must be 0)`,
    `auto-approvals       ${metrics.autoApprovals}            (must be 0: no such outcome exists)`,
    `citation validity    ${pct(metrics.cases - metrics.citationFailures, metrics.cases)}`,
    `IBAN recall          ${pct(metrics.recallHits, metrics.recallTotal)}`,
    `dropped quotes       ${metrics.droppedClaims}`,
    `errors               ${metrics.errors}`,
    `legit approvable     ${pct(metrics.legitApprovable, metrics.legitTotal)}`,
    `hard-neg approvable  ${pct(metrics.hardApprovable, metrics.hardTotal)}`,
    "",
  ].join("\n");
}
