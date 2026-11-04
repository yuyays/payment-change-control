import type { ExtractedEmail, ProposedClaim } from "@pcc/domain";

export interface ExtractionInput {
  readonly rawBody: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
}

export interface ExtractionOutcome {
  readonly extraction: ExtractedEmail;
  /** Claims the model proposed whose quote could not be located verbatim. */
  readonly dropped: ReadonlyArray<ProposedClaim>;
  readonly provider: string;
}

export type ExtractionErrorCode =
  | "provider_error"
  | "invalid_model_output"
  | "empty_email";

export class ExtractionError extends Error {
  readonly _tag = "ExtractionError";
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface Extractor {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionOutcome>;
}
