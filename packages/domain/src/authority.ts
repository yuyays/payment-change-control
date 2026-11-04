import type { DecisionOwner } from "./types.js";

/**
 * The authority table.
 *
 * Every decision in the system names exactly one owner. This table is the single
 * source of truth: the server gate reads it before acting, and the UI renders it
 * so the table on screen is the table being enforced.
 */
export const AUTHORITY = {
  "extract.claims": "model",
  "extract.citation.verify": "code",
  "check.senderDomain": "code",
  "check.replyTo": "code",
  "check.callbackSource": "code",
  "check.coolingOff": "code",
  "check.changeFrequency": "code",
  "decide.approveChange": "human",
  "decide.releasePayment": "human",
} as const satisfies Record<string, DecisionOwner>;

export type Action = keyof typeof AUTHORITY;

export type AuthorityViolationCode = "not_the_owner";

export class AuthorityViolation extends Error {
  readonly _tag = "AuthorityViolation";
  constructor(
    readonly action: Action,
    readonly expected: DecisionOwner,
    readonly actual: DecisionOwner,
  ) {
    super(
      `AuthorityViolation: ${action} is owned by "${expected}", but "${actual}" attempted it`,
    );
    this.name = "AuthorityViolation";
  }
}

export const ownerOf = (action: Action): DecisionOwner => AUTHORITY[action];

/**
 * The gate. Call this immediately before performing any side effect.
 * A model may never act on a decision it does not own.
 */
export function assertAuthority(action: Action, actor: DecisionOwner): void {
  const expected = AUTHORITY[action];
  if (expected !== actor) {
    throw new AuthorityViolation(action, expected, actor);
  }
}

export const authorityTable = (): ReadonlyArray<readonly [Action, DecisionOwner]> =>
  Object.entries(AUTHORITY) as ReadonlyArray<readonly [Action, DecisionOwner]>;
