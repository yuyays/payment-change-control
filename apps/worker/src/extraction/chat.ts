import { anchorClaims } from "@pcc/domain";
import { EXTRACTION_SYSTEM_PROMPT, renderEmail } from "./prompt.js";
import { parseExtraction } from "./schema.js";
import {
  ExtractionError,
  type ExtractionInput,
  type ExtractionOutcome,
  type Extractor,
} from "./types.js";

export interface ChatExtractorConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Read `choices[0].message.content` without asserting a shape we do not control. */
function contentOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (!isRecord(first)) return null;
  const message = first["message"];
  if (!isRecord(message)) return null;
  const content = message["content"];
  return typeof content === "string" ? content : null;
}

/**
 * Any OpenAI-compatible chat completions endpoint.
 *
 * The response is parsed by a strict schema, and every quote is re-anchored
 * against the raw email. The model never supplies offsets, values, or a decision.
 */
export class ChatExtractor implements Extractor {
  readonly name: string;

  constructor(private readonly config: ChatExtractorConfig) {
    this.name = `chat:${config.model}`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    if (input.rawBody.trim() === "") {
      throw new ExtractionError("empty_email", "Email body is empty.");
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = (withTemperature: boolean): string =>
      JSON.stringify({
        model: this.config.model,
        ...(withTemperature ? { temperature: 0 } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: renderEmail(input) },
        ],
      });

    const send = (payload: string): Promise<Response> =>
      fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: payload,
      });

    let response = await send(body(true));
    // Some newer model families reject a non-default temperature. Retry once without it.
    if (response.status === 400) {
      response = await send(body(false));
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new ExtractionError(
        "provider_error",
        `Extraction provider returned HTTP ${response.status}: ${detail}`,
      );
    }

    const payload: unknown = await response.json();
    const content = contentOf(payload);
    if (content === null) {
      throw new ExtractionError("invalid_model_output", "Provider returned no text content.");
    }

    const parsed = parseExtraction(content);
    if (parsed === null) {
      throw new ExtractionError(
        "invalid_model_output",
        "Model output did not match the claim schema; the response was discarded in full.",
      );
    }

    const { anchored, dropped } = anchorClaims(input.rawBody, parsed.claims);

    return {
      extraction: {
        fromAddress: input.fromAddress,
        replyTo: input.replyTo,
        claims: anchored,
      },
      dropped,
      provider: this.name,
    };
  }
}
