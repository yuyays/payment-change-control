import { describe, expect, it } from "vite-plus/test";
import { createExtractor } from "../extraction/index.js";
import { formatReport, runCases } from "./runner.js";

describe("eval suite (offline extractor)", () => {
  it("holds the safety invariants and prints the numbers", async () => {
    const run = await runCases(createExtractor({}));
    // eslint-disable-next-line no-console
    console.log(formatReport(run));

    expect(run.metrics.fraudEscapes).toBe(0);
    expect(run.metrics.autoApprovals).toBe(0);
    expect(run.metrics.citationFailures).toBe(0);
    expect(run.metrics.legitApprovable).toBe(run.metrics.legitTotal);
    expect(run.metrics.recallHits).toBeGreaterThanOrEqual(
      Math.ceil(run.metrics.recallTotal * 0.9),
    );
  });
});
