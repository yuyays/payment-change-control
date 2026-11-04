import { ChatExtractor } from "./chat.js";
import { CompromisedFabricatedExtractor, CompromisedSchemaExtractor } from "./compromised.js";
import { RuleBasedExtractor } from "./ruleBased.js";
import type { Extractor } from "./types.js";

export interface ExtractorConfig {
  readonly EXTRACTION_API_KEY?: string | undefined;
  readonly EXTRACTION_BASE_URL?: string | undefined;
  readonly EXTRACTION_MODEL?: string | undefined;
  /** Fault injection. Not for production. */
  readonly EXTRACTION_MODE?: string | undefined;
}

/**
 * With an API key, use a real model. Without one, fall back to the offline
 * regex extractor so the app runs end to end on a fresh checkout.
 *
 * EXTRACTION_MODE swaps in a deliberately hostile model for the demo.
 */
export function createExtractor(config: ExtractorConfig): Extractor {
  if (config.EXTRACTION_MODE === "compromised-schema") {
    return new CompromisedSchemaExtractor();
  }
  if (config.EXTRACTION_MODE === "compromised-fabricated") {
    return new CompromisedFabricatedExtractor();
  }

  const apiKey = config.EXTRACTION_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    return new RuleBasedExtractor();
  }

  return new ChatExtractor({
    baseUrl: config.EXTRACTION_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model: config.EXTRACTION_MODEL ?? "gpt-4o-mini",
  });
}

export * from "./types.js";
export { parseExtraction } from "./schema.js";
