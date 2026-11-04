import { anchorClaims, type ProposedClaim } from "@pcc/domain";
import {
  ExtractionError,
  type ExtractionInput,
  type ExtractionOutcome,
  type Extractor,
} from "./types.js";

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,6}(?: ?[A-Z0-9]{1,3})?\b/gi;
const PHONE = /\+?\d[\d\s()-]{7,}\d/g;

/**
 * Offline extractor for local development and tests.
 *
 * It is deliberately dumb — regex, not language understanding. Its job is to prove
 * the pipeline (propose -> anchor -> verify) works without a network or an API key.
 * Swap in `ChatExtractor` by setting EXTRACTION_API_KEY.
 */
export class RuleBasedExtractor implements Extractor {
  readonly name = "rule-based";

  extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    if (input.rawBody.trim() === "") {
      return Promise.reject(new ExtractionError("empty_email", "Email body is empty."));
    }

    const proposed: ProposedClaim[] = [];
    const ibanRanges: Array<readonly [number, number]> = [];

    for (const match of input.rawBody.matchAll(IBAN)) {
      const start = match.index;
      proposed.push({ field: "iban", quote: match[0] });
      ibanRanges.push([start, start + match[0].length]);
    }

    // A long IBAN looks like a phone number to a digit regex. Do not double-report it.
    const overlapsIban = (start: number, end: number): boolean =>
      ibanRanges.some(([from, to]) => start < to && end > from);

    for (const match of input.rawBody.matchAll(PHONE)) {
      const start = match.index;
      if (overlapsIban(start, start + match[0].length)) continue;
      proposed.push({ field: "callbackPhone", quote: match[0] });
    }

    const { anchored, dropped } = anchorClaims(input.rawBody, proposed);

    return Promise.resolve({
      extraction: {
        fromAddress: input.fromAddress,
        replyTo: input.replyTo,
        claims: anchored,
      },
      dropped,
      provider: this.name,
    });
  }
}
