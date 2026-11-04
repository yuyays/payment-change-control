import { assertAuthority } from "./authority.js";
import {
  callbackIsTrusted,
  changedRecently,
  citationIsVerbatim,
  coolingOffRemaining,
  domainVerdict,
  normalizeDomain,
} from "./checks.js";
import type { ChangeRequest, Claim, DecisionOwner, Policy, Reason, Vendor } from "./types.js";

export const DEFAULT_POLICY: Policy = {
  coolingOffHours: 48,
  requiredApprovals: 2,
  frequencyWindowDays: 180,
};

/**
 * Note what is missing: there is no "approve" outcome.
 *
 * The machine can only reject or escalate. Approval is a separate human action
 * (`approve`), so a model that hallucinates, gets prompt-injected, or simply
 * decides to be helpful has no path to changing a bank account.
 */
export type Outcome = "reject" | "escalate";

export interface Evaluation {
  readonly outcome: Outcome;
  readonly reasons: ReadonlyArray<Reason>;
  /** Claims whose citations checked out. Everything else was discarded. */
  readonly validClaims: ReadonlyArray<Claim>;
  /** Earliest instant a human may approve. */
  readonly eligibleAt: number;
}

const reason = (code: string, detail: string, owner: DecisionOwner, blocking: boolean): Reason => ({
  code,
  detail,
  owner,
  blocking,
});

export function evaluate(
  request: ChangeRequest,
  vendor: Vendor,
  now: number,
  policy: Policy = DEFAULT_POLICY,
): Evaluation {
  const reasons: Reason[] = [];

  const validClaims: Claim[] = [];
  for (const claim of request.extraction.claims) {
    if (citationIsVerbatim(request.rawBody, claim.citation)) {
      validClaims.push(claim);
    } else {
      reasons.push(
        reason(
          "claim.citation.invalid",
          `Claim for "${claim.field}" cites text that is not present at the stated offset.`,
          "code",
          true,
        ),
      );
    }
  }

  const senderDomain = normalizeDomain(hostOf(request.extraction.fromAddress));
  const verdict = domainVerdict(senderDomain, vendor.registeredDomain);

  if (verdict === "lookalike") {
    reasons.push(
      reason(
        "sender.domain.lookalike",
        `Sender domain "${senderDomain}" resembles the registered domain "${vendor.registeredDomain}" but is not it.`,
        "code",
        true,
      ),
    );
  } else if (verdict === "mismatch") {
    reasons.push(
      reason(
        "sender.domain.mismatch",
        `Sender domain "${senderDomain}" does not match the registered domain "${vendor.registeredDomain}".`,
        "code",
        true,
      ),
    );
  }

  const replyTo = request.extraction.replyTo;
  if (replyTo !== null) {
    const replyDomain = normalizeDomain(hostOf(replyTo));
    if (replyDomain !== senderDomain) {
      reasons.push(
        reason(
          "replyTo.mismatch",
          `Reply-To "${replyDomain}" differs from the sender domain "${senderDomain}".`,
          "code",
          true,
        ),
      );
    }
  }

  for (const claim of validClaims) {
    if (claim.field !== "callbackPhone") continue;
    if (!callbackIsTrusted(claim.value, vendor)) {
      reasons.push(
        reason(
          "callback.untrusted",
          `Callback number supplied in the message does not match the number on file. Untrusted input cannot become a contact channel.`,
          "code",
          true,
        ),
      );
    }
  }

  if (changedRecently(vendor, now, policy.frequencyWindowDays)) {
    reasons.push(
      reason(
        "vendor.changed_recently",
        `This vendor changed bank details within the last ${policy.frequencyWindowDays} days.`,
        "code",
        false,
      ),
    );
  }

  const remaining = coolingOffRemaining(request.receivedAt, now, policy.coolingOffHours);
  if (remaining > 0) {
    reasons.push(
      reason(
        "cooling_off.pending",
        `Cooling-off period still has ${Math.ceil(remaining / 3_600_000)}h remaining.`,
        "code",
        true,
      ),
    );
  }

  const outcome: Outcome = validClaims.length === 0 ? "reject" : "escalate";

  return {
    outcome,
    reasons,
    validClaims,
    eligibleAt: request.receivedAt + policy.coolingOffHours * 3_600_000,
  };
}

export interface Approval {
  readonly actor: DecisionOwner;
  readonly approverId: string;
  readonly at: number;
}

export type ApprovalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Human-only. Throws `AuthorityViolation` if a non-human actor is present in the
 * approval list — including a model pretending to be one.
 */
export function approve(
  evaluation: Evaluation,
  approvals: ReadonlyArray<Approval>,
  now: number,
  policy: Policy = DEFAULT_POLICY,
): ApprovalResult {
  for (const approval of approvals) {
    assertAuthority("decide.approveChange", approval.actor);
  }

  if (evaluation.outcome === "reject") {
    return { ok: false, reason: "This request was rejected and cannot be approved." };
  }

  const blocking = evaluation.reasons.filter((r) => r.blocking && r.code !== "cooling_off.pending");
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `Blocking findings remain: ${blocking.map((r) => r.code).join(", ")}`,
    };
  }

  if (now < evaluation.eligibleAt) {
    return { ok: false, reason: "Cooling-off period has not elapsed." };
  }

  const humans = new Set(approvals.filter((a) => a.actor === "human").map((a) => a.approverId));
  if (humans.size < policy.requiredApprovals) {
    return {
      ok: false,
      reason: `Requires ${policy.requiredApprovals} distinct human approvers; have ${humans.size}.`,
    };
  }

  return { ok: true };
}

/** Extract the domain part of an address without throwing on malformed input. */
export function hostOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1);
}
