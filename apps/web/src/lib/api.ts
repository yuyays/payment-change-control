export interface ClaimCitation {
  readonly field: string;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}

export interface Claim {
  readonly field: string;
  readonly value: string;
  readonly citation: ClaimCitation;
}

export interface Reason {
  readonly code: string;
  readonly detail: string;
  readonly owner: "model" | "code" | "human";
  readonly blocking: boolean;
}

export interface Evaluation {
  readonly outcome: "reject" | "escalate";
  readonly reasons: ReadonlyArray<Reason>;
  readonly validClaims: ReadonlyArray<Claim>;
  readonly eligibleAt: number;
}

export type Status = "cooling_off" | "ready_for_review" | "approved" | "rejected";

export interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly registeredDomain: string;
  readonly phoneOnFile: string;
}

export interface RequestState {
  readonly request: {
    readonly id: string;
    readonly vendorId: string;
    readonly receivedAt: number;
    readonly rawBody: string;
    readonly extraction: {
      readonly fromAddress: string;
      readonly replyTo: string | null;
      readonly claims: ReadonlyArray<Claim>;
    };
  };
  readonly vendor: Vendor;
  readonly evaluation: Evaluation;
  readonly status: Status;
  readonly approvals: ReadonlyArray<{ actor: string; approverId: string; at: number }>;
}

export interface TraceEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
}

export interface StateResponse {
  readonly state: RequestState | null;
  readonly events: ReadonlyArray<TraceEvent>;
}

export interface SeedPayload {
  readonly vendor: Vendor & { readonly bankAccount: { bankName: string; iban: string } };
  readonly email: { rawBody: string; fromAddress: string; replyTo: string | null };
  readonly receivedAt?: number;
}

const base = import.meta.env.VITE_API_URL ?? "";
const url = (path: string): string => `${base}/api${path}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const messageOf = (body: unknown, status: number): string => {
  if (isRecord(body)) {
    const message = body["message"];
    if (typeof message === "string") return message;
    const error = body["error"];
    if (typeof error === "string") {
      const expected = body["expected"];
      return typeof expected === "string" ? `${error} (owner: ${expected})` : error;
    }
    const reason = body["reason"];
    if (typeof reason === "string") return reason;
  }
  return `HTTP ${status}`;
};

/**
 * Unchecked JSON boundary. The worker owns these shapes; this client does not
 * validate them field by field.
 */
const json = async <T>(response: Response): Promise<T> => {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(messageOf(body, response.status));
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- HTTP boundary; the shape is owned by the worker
  return body as T;
};

export const getState = (id: string): Promise<StateResponse> =>
  fetch(url(`/requests/${id}/state`)).then((r) => json<StateResponse>(r));

export const seed = (id: string, payload: SeedPayload): Promise<unknown> =>
  fetch(url(`/requests/${id}/intake`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => json<unknown>(r));

export interface ReplayResult {
  readonly decision: {
    readonly same: boolean;
    readonly evaluatedAt: number;
    readonly stored: { readonly outcome: string; readonly reasons: ReadonlyArray<string> };
    readonly replayed: { readonly outcome: string; readonly reasons: ReadonlyArray<string> };
  };
  readonly claims: null | {
    readonly extractor: string;
    readonly stored: number;
    readonly replayed: number;
    readonly diff: {
      readonly added: ReadonlyArray<string>;
      readonly removed: ReadonlyArray<string>;
    };
  };
}

export const replay = (
  id: string,
  extractor: "stored" | "current" = "stored",
): Promise<ReplayResult> =>
  fetch(url(`/requests/${id}/replay`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extractor }),
  }).then((r) => json<ReplayResult>(r));

export const approve = async (
  id: string,
  approverId: string,
  actor: "human" | "model" = "human",
): Promise<{ ok: boolean; reason?: string }> => {
  const response = await fetch(url(`/requests/${id}/approve`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approverId, actor }),
  });

  const body: unknown = await response.json();
  if (!response.ok) throw new Error(messageOf(body, response.status));
  if (!isRecord(body) || typeof body["ok"] !== "boolean") {
    throw new Error("Malformed approval response.");
  }
  return { ok: body["ok"] };
};
