/** Manual verification of control of a registered phone, not of a bank account. */
export const CALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type CallbackReport = "completed" | "failed";

export type CallbackChallenge = {
  readonly phoneOnFile: string;
  readonly createdAt: number;
  readonly expiresAt: number;
} & (
  | { readonly status: "pending" }
  | { readonly status: "expired"; readonly resolvedAt: number }
  | { readonly status: CallbackReport; readonly resolvedAt: number; readonly operatorId: string }
);

export function createCallback(phoneOnFile: string, now: number): CallbackChallenge {
  return { phoneOnFile, createdAt: now, expiresAt: now + CALLBACK_WINDOW_MS, status: "pending" };
}

export function expireCallback(callback: CallbackChallenge, now: number): CallbackChallenge {
  return callback.status === "pending" && now >= callback.expiresAt
    ? { ...callback, status: "expired", resolvedAt: callback.expiresAt }
    : callback;
}

export function reportCallback(
  callback: CallbackChallenge,
  outcome: CallbackReport,
  operatorId: string,
  now: number,
): CallbackChallenge {
  const current = expireCallback(callback, now);
  return current.status === "pending"
    ? { ...current, status: outcome, operatorId, resolvedAt: now }
    : current;
}

export function callbackApprovalBlock(callback: CallbackChallenge | undefined): string | null {
  return callback?.status === "completed" ? null : `callback.${callback?.status ?? "missing"}`;
}
