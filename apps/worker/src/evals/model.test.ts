import { describe, expect, it } from "vite-plus/test";
import { createExtractor } from "../extraction/index.js";
import { formatReport, runCases } from "./runner.js";

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const apiKey = env["EXTRACTION_API_KEY"] ?? "";
const enabled = apiKey !== "";

/**
 * Runs only when EXTRACTION_API_KEY is set.
 *
 *   EXTRACTION_API_KEY=... EXTRACTION_MODEL=... pnpm --filter @pcc/worker evals:model
 *
 * The safety invariants are asserted. Quality numbers (recall, legit approvable) are
 * printed rather than asserted, because a real model is allowed to be worse than a
 * regex at finding IBANs — that is a result, not a failure.
 */
const suite = enabled ? describe : describe.skip;

suite("eval suite (real model)", () => {
  it("holds the safety invariants against a real model", async () => {
    const extractor = createExtractor({
      EXTRACTION_API_KEY: apiKey,
      EXTRACTION_BASE_URL: env["EXTRACTION_BASE_URL"],
      EXTRACTION_MODEL: env["EXTRACTION_MODEL"],
    });

    const run = await runCases(extractor);
    // eslint-disable-next-line no-console
    console.log(formatReport(run));

    expect(run.metrics.fraudEscapes).toBe(0);
    expect(run.metrics.autoApprovals).toBe(0);
    expect(run.metrics.citationFailures).toBe(0);
  }, 900_000);
});
