import type { ClaimField, ProposedClaim } from "@pcc/domain";

export const CLAIM_FIELDS: ReadonlyArray<ClaimField> = ["bankName", "iban", "callbackPhone"];

const MAX_CLAIMS = 20;
const MAX_QUOTE = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isClaimField = (value: unknown): value is ClaimField =>
  typeof value === "string" && (CLAIM_FIELDS as ReadonlyArray<string>).includes(value);

export interface ParsedExtraction {
  readonly claims: ReadonlyArray<ProposedClaim>;
}

/** Strip a fenced code block, then trim to the outermost JSON object. */
function unwrap(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start === -1 || end === -1 || end < start ? body : body.slice(start, end + 1);
}

/**
 * Strict parser for model output.
 *
 * The schema has room for exactly one thing: `claims`, each with a `field` and a
 * `quote`. A response carrying a verdict, a score, an approval, or any extra key
 * is rejected outright rather than partly used.
 */
export function parseExtraction(text: string): ParsedExtraction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(text));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (Object.keys(parsed).some((key) => key !== "claims")) return null;

  const claims = parsed["claims"];
  if (!Array.isArray(claims) || claims.length > MAX_CLAIMS) return null;

  const result: ProposedClaim[] = [];
  for (const item of claims) {
    if (!isRecord(item)) return null;
    if (Object.keys(item).some((key) => key !== "field" && key !== "quote")) return null;

    const field = item["field"];
    const quote = item["quote"];
    if (!isClaimField(field)) return null;
    if (typeof quote !== "string" || quote.length === 0 || quote.length > MAX_QUOTE) return null;

    result.push({ field, quote });
  }

  return { claims: result };
}
