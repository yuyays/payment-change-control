import { extractWellFormed, isWellFormedValue } from "./checks.js";
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
    if (claim.quote.trim() === "") {
      dropped.push(claim);
      continue;
    }

    const key = `${claim.field}\u0000${claim.quote}`;
    if (seen.has(key)) continue;

    const located = rawBody.indexOf(claim.quote);
    if (located === -1) {
      dropped.push(claim);
      continue;
    }

    // The whole quote is ideal; otherwise take a well-formed token from inside it.
    const found = isWellFormedValue(claim.field, claim.quote)
      ? { value: claim.quote, offset: 0 }
      : extractWellFormed(claim.field, claim.quote);

    if (found === null) {
      dropped.push(claim);
      continue;
    }

    const start = located + found.offset;
    const end = start + found.value.length;
    if (rawBody.slice(start, end) !== found.value) {
      dropped.push(claim);
      continue;
    }

    seen.add(key);
    const citation: Citation = {
      field: claim.field,
      quote: found.value,
      start,
      end,
    };
    anchored.push({ field: claim.field, value: found.value, citation });
  }

  return { anchored, dropped };
}
