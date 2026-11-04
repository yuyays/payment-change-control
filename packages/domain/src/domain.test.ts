import { describe, expect, it } from "vite-plus/test";
import {
  approve,
  AuthorityViolation,
  DEFAULT_POLICY,
  evaluate,
  type ChangeRequest,
  type Claim,
  type Vendor,
} from "./index.js";

const HOUR = 3_600_000;

const vendor: Vendor = {
  id: "v-1",
  name: "Acme Industrial",
  registeredDomain: "acme-industrial.com",
  phoneOnFile: "+81 3 5555 0100",
  bankAccount: { bankName: "MUFG", iban: "JP00 0000 0000 0000" },
  lastBankChangeAt: null,
};

const BODY =
  "Hello, please update our bank account to ACME Trust, IBAN DE89 3704 0044 0532 0130 00. " +
  "You can reach me on +81 90 1234 5678.";

function cite(field: Claim["citation"]["field"], quote: string, at?: number): Claim {
  const start = at ?? BODY.indexOf(quote);
  return {
    field,
    value: quote,
    citation: { field, quote, start, end: start + quote.length },
  };
}

function request(overrides: Partial<ChangeRequest["extraction"]> = {}): ChangeRequest {
  return {
    id: "req-1",
    vendorId: vendor.id,
    receivedAt: 0,
    rawBody: BODY,
    extraction: {
      fromAddress: "billing@acme-industrial.com",
      replyTo: null,
      claims: [cite("iban", "DE89 3704 0044 0532 0130 00")],
      ...overrides,
    },
  };
}

describe("evaluate", () => {
  it("escalates a clean request instead of approving it", () => {
    const result = evaluate(request(), vendor, 1 * HOUR);
    expect(result.outcome).toBe("escalate");
    expect(result.validClaims).toHaveLength(1);
  });

  it("rejects a claim whose citation does not match the source text", () => {
    const forged = cite("iban", "DE89 3704 0044 0532 0130 00", 5);
    const result = evaluate(request({ claims: [forged] }), vendor, 1 * HOUR);
    expect(result.outcome).toBe("reject");
    expect(result.reasons.some((r) => r.code === "claim.citation.invalid")).toBe(true);
  });

  it("flags a lookalike sender domain as blocking", () => {
    const result = evaluate(
      request({ fromAddress: "billing@acme-industria1.com" }),
      vendor,
      1 * HOUR,
    );
    expect(result.reasons.some((r) => r.code === "sender.domain.lookalike")).toBe(true);
  });

  it("refuses a callback number supplied by the email", () => {
    const result = evaluate(
      request({
        claims: [
          cite("iban", "DE89 3704 0044 0532 0130 00"),
          cite("callbackPhone", "+81 90 1234 5678"),
        ],
      }),
      vendor,
      1 * HOUR,
    );
    expect(result.reasons.some((r) => r.code === "callback.untrusted")).toBe(true);
  });

  it("cannot be approved before the cooling-off period elapses", () => {
    const at = 1 * HOUR;
    const result = evaluate(request(), vendor, at);
    const outcome = approve(
      result,
      [
        { actor: "human", approverId: "clerk", at },
        { actor: "human", approverId: "controller", at },
      ],
      at,
    );
    expect(outcome.ok).toBe(false);
  });

  it("throws when a model attempts to approve", () => {
    const at = 49 * HOUR;
    const result = evaluate(request(), vendor, at);
    expect(() =>
      approve(
        result,
        [
          { actor: "model", approverId: "claude", at },
          { actor: "human", approverId: "controller", at },
        ],
        at,
      ),
    ).toThrow(AuthorityViolation);
  });

  it("accepts two distinct human approvers after cooling off", () => {
    const at = 49 * HOUR;
    const result = evaluate(request(), vendor, at);
    const outcome = approve(
      result,
      [
        { actor: "human", approverId: "clerk", at },
        { actor: "human", approverId: "controller", at },
      ],
      at,
      DEFAULT_POLICY,
    );
    expect(outcome).toEqual({ ok: true });
  });

  it("rejects a single approver even when everything else is clean", () => {
    const at = 49 * HOUR;
    const result = evaluate(request(), vendor, at);
    const outcome = approve(result, [{ actor: "human", approverId: "clerk", at }], at);
    expect(outcome.ok).toBe(false);
  });
});
