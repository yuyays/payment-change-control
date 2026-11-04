import { isWellFormedValue } from "./checks.js";
import type { Citation, Claim, ClaimField } from "./types.js";

/** What the model is allowed to produce: a field name and a verbatim quote. Nothing else. */
export interface ProposedClaim {
  readonly field: ClaimField;
  readonly quote: string;
}

export interface AnchorResult {
  readonly anchored: ReadonlyArray<Claim>;
  readonly dropped: ReadonlyArray<ProposedClaim>;
}

/**
 * Turn model-proposed quotes into anchored claims.
 *
 * The model does not supply offsets. It supplies a quote; code locates it. A quote
 * that does not appear verbatim in the source is dropped, never "fixed up".
 */
export function anchorClaims(
  rawBody: string,
  proposed: ReadonlyArray<ProposedClaim>,
): AnchorResult {
  const anchored: Claim[] = [];
  const dropped: ProposedClaim[] = [];
  const seen = new Set<string>();

  for (const claim of proposed) {
    if (claim.quote.trim() === "" || !isWellFormedValue(claim.field, claim.quote)) {
      dropped.push(claim);
      continue;
    }

    const key = `${claim.field}\u0000${claim.quote}`;
    if (seen.has(key)) continue;

    const start = rawBody.indexOf(claim.quote);
    if (start === -1) {
      dropped.push(claim);
      continue;
    }

    seen.add(key);
    const citation: Citation = {
      field: claim.field,
      quote: claim.quote,
      start,
      end: start + claim.quote.length,
    };
    anchored.push({ field: claim.field, value: claim.quote, citation });
  }

  return { anchored, dropped };
}
