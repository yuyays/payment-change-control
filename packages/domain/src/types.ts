/**
 * Domain vocabulary for a vendor payment-detail change request.
 *
 * Everything here is plain data. No I/O, no runtime, no framework.
 * If it needs a database or a network call, it does not belong in this package.
 */

/** Who is allowed to make a given decision. Enforced in `authority.ts`. */
export type DecisionOwner = "model" | "code" | "human";

export interface BankAccount {
  readonly bankName: string;
  readonly iban: string;
}

export interface Vendor {
  readonly id: string;
  readonly name: string;
  /** The domain the vendor is registered under, e.g. "acme-industrial.com". */
  readonly registeredDomain: string;
  /** The only callback number that may ever be used to verify a change. */
  readonly phoneOnFile: string;
  readonly bankAccount: BankAccount;
  /** Epoch ms of the last bank-detail change, or null if never changed. */
  readonly lastBankChangeAt: number | null;
}

export type ClaimField = "bankName" | "iban" | "callbackPhone";

/**
 * A model-produced claim, always anchored to a verbatim span of the source text.
 * The citation is checked by code; a claim without a valid citation is discarded.
 */
export interface Citation {
  readonly field: ClaimField;
  readonly quote: string;
  /** UTF-16 offset into `ChangeRequest.rawBody`. */
  readonly start: number;
  readonly end: number;
}

export interface Claim {
  readonly field: ClaimField;
  readonly value: string;
  readonly citation: Citation;
}

/**
 * Output of the extraction step. This is the *only* thing the model contributes:
 * claims plus citations. It cannot carry a risk score, a verdict, or an approval.
 */
export interface ExtractedEmail {
  readonly fromAddress: string;
  readonly replyTo: string | null;
  readonly claims: ReadonlyArray<Claim>;
}

export interface ChangeRequest {
  readonly id: string;
  readonly vendorId: string;
  readonly receivedAt: number;
  /** Raw email text the citations point into. Untrusted input. */
  readonly rawBody: string;
  readonly extraction: ExtractedEmail;
}

/** Why a request cannot proceed. Every reason names the owner of the finding. */
export interface Reason {
  readonly code: string;
  readonly detail: string;
  readonly owner: DecisionOwner;
  /** A blocking reason can never be waived by the model or by a single approver. */
  readonly blocking: boolean;
}

export interface Policy {
  /** Hours between intake and the earliest possible approval. */
  readonly coolingOffHours: number;
  /** Distinct human approvers required. */
  readonly requiredApprovals: number;
  /** Domain changes within this window are flagged as abnormal. */
  readonly frequencyWindowDays: number;
}
