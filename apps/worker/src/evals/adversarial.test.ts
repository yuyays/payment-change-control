import { describe, expect, it } from "vite-plus/test";
import { createExtractor } from "../extraction/index.js";
import { MUTATIONS } from "./adversarial.js";
import { CASES } from "./cases.js";
import { runCase } from "./runner.js";

const BASES = CASES.filter((testCase) => testCase.category === "legit");

describe("adversarial mutations", () => {
  it("changes the decision only when the signal changes", async () => {
    const extractor = createExtractor({});
    let checked = 0;
    const failures: string[] = [];

    for (const base of BASES) {
      const baseline = await runCase(extractor, base);

      for (const mutation of MUTATIONS) {
        const row = await runCase(extractor, mutation.apply(base));
        const label = `${base.id} + ${mutation.id}`;
        checked += 1;

        if (mutation.expectation.kind === "blocked") {
          if (row.approvable) failures.push(`${label}: expected blocked, was approvable`);
          if (!row.reasons.includes(mutation.expectation.code)) {
            failures.push(
              `${label}: expected reason ${mutation.expectation.code}, got [${row.reasons.join(", ")}]`,
            );
          }
        } else {
          if (!row.approvable) failures.push(`${label}: expected approvable, got blocked`);
          if (row.reasons.join("|") !== baseline.reasons.join("|")) {
            failures.push(
              `${label}: decision changed unexpectedly, [${baseline.reasons.join(", ")}] -> [${row.reasons.join(", ")}]`,
            );
          }
        }
      }
    }

    console.log(`adversarial: ${checked} mutations, ${failures.length} failures`);
    for (const failure of failures) console.log(`  ${failure}`);

    expect(failures).toEqual([]);
    expect(checked).toBe(BASES.length * MUTATIONS.length);
  });
});
