import type { Claim } from "@pcc/domain";

const compact = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

export const claimKey = (claim: Claim): string => `${claim.field}:${compact(claim.value)}`;

export interface ClaimDiff {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/** Compare two extracted claim sets by field + normalised value. */
export function diffClaims(
  before: ReadonlyArray<Claim>,
  after: ReadonlyArray<Claim>,
): ClaimDiff {
  const beforeKeys = new Set(before.map(claimKey));
  const afterKeys = new Set(after.map(claimKey));

  return {
    added: [...afterKeys].filter((key) => !beforeKeys.has(key)),
    removed: [...beforeKeys].filter((key) => !afterKeys.has(key)),
  };
}
