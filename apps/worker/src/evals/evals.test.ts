import { approve, evaluate, type ChangeRequest } from "@pcc/domain";
import { describe, expect, it } from "vite-plus/test";
import { createExtractor } from "../extraction/index.js";
import { CASES } from "./cases.js";

const NOW = Date.UTC(2026, 10, 1);
const HOUR = 3_600_000;

const APPROVERS = [
  { actor: "human" as const, approverId: "clerk", at: NOW + 72 * HOUR },
  { actor: "human" as const, approverId: "controller", at: NOW + 72 * HOUR },
];

const compact = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

interface Row {
  readonly id: string;
  readonly category: string;
  readonly outcome: string;
  readonly approvable: boolean;
  readonly blocking: number;
  readonly claims: number;
  readonly citationsValid: boolean;
  readonly ibanRecalled: boolean | null;
}

describe("eval suite", () => {
  it("holds the safety invariants and prints the numbers", async () => {
    const extractor = createExtractor({});
    const rows: Row[] = [];

    for (const testCase of CASES) {
      const extracted = await extractor.extract(testCase.email);
      const request: ChangeRequest = {
        id: testCase.id,
        vendorId: testCase.vendor.id,
        receivedAt: NOW,
        rawBody: testCase.email.rawBody,
        extraction: extracted.extraction,
      };

      const evaluation = evaluate(request, testCase.vendor, NOW + HOUR);
      const approvable = approve(evaluation, APPROVERS, NOW + 72 * HOUR).ok;

      const claims = extracted.extraction.claims;
      const citationsValid = claims.every(
        (claim) =>
          testCase.email.rawBody.slice(claim.citation.start, claim.citation.end) ===
          claim.citation.quote,
      );

      const ibanRecalled =
        testCase.expectedIban === undefined
          ? null
          : claims.some(
              (claim) =>
                claim.field === "iban" &&
                compact(claim.value) === compact(testCase.expectedIban ?? ""),
            );

      rows.push({
        id: testCase.id,
        category: testCase.category,
        outcome: evaluation.outcome,
        approvable,
        blocking: evaluation.reasons.filter((r) => r.blocking).length,
        claims: claims.length,
        citationsValid,
        ibanRecalled,
      });
    }

    const byCategory = (category: string) => rows.filter((r) => r.category === category);
    const fraud = byCategory("fraud");
    const legit = byCategory("legit");
    const hard = byCategory("hard_negative");

    const fraudEscapes = fraud.filter((r) => r.approvable).length;
    const legitBlocked = legit.filter((r) => !r.approvable).length;
    const hardBlocked = hard.filter((r) => !r.approvable).length;
    const autoApprovals = rows.filter((r) => r.outcome === "approve").length;
    const citationFailures = rows.filter((r) => !r.citationsValid).length;

    const recallCases = rows.filter((r) => r.ibanRecalled !== null);
    const recallHits = recallCases.filter((r) => r.ibanRecalled === true).length;

    const pct = (n: number, d: number): string =>
      d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;

    const table = rows
      .map(
        (r) =>
          `${r.id.padEnd(26)} ${r.category.padEnd(14)} ${r.outcome.padEnd(9)} ` +
          `${r.approvable ? "approvable" : "blocked   "} claims=${r.claims} blocking=${r.blocking}`,
      )
      .join("\n");

    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        table,
        "",
        "── metrics ────────────────────────────────────────",
        `cases                ${rows.length}`,
        `fraud escapes        ${fraudEscapes} / ${fraud.length}   (must be 0)`,
        `auto-approvals       ${autoApprovals}            (must be 0: no such outcome exists)`,
        `citation validity    ${pct(rows.length - citationFailures, rows.length)}`,
        `IBAN recall          ${pct(recallHits, recallCases.length)}`,
        `legit approvable     ${pct(legit.length - legitBlocked, legit.length)}`,
        `hard-neg approvable  ${pct(hard.length - hardBlocked, hard.length)}  (needs human verification otherwise)`,
        "",
      ].join("\n"),
    );

    expect(fraudEscapes).toBe(0);
    expect(autoApprovals).toBe(0);
    expect(citationFailures).toBe(0);
    expect(legitBlocked).toBe(0);
    expect(recallHits).toBeGreaterThanOrEqual(Math.ceil(recallCases.length * 0.9));
  });
});
