import { describe, expect, it } from "vite-plus/test";
import {
  callbackApprovalBlock,
  createCallback,
  expireCallback,
  reportCallback,
} from "./callback.js";

describe("callback verification", () => {
  const pending = createCallback("+1234", 100);

  it("blocks missing, pending, failed and expired challenges", () => {
    expect(callbackApprovalBlock(undefined)).toBe("callback.missing");
    expect(callbackApprovalBlock(pending)).toBe("callback.pending");
    expect(callbackApprovalBlock(reportCallback(pending, "failed", "op", 101))).toBe(
      "callback.failed",
    );
    expect(callbackApprovalBlock(expireCallback(pending, pending.expiresAt))).toBe(
      "callback.expired",
    );
  });

  it("accepts a timely completion and does not later expire or replace it", () => {
    const completed = reportCallback(pending, "completed", "op", pending.expiresAt - 1);
    expect(callbackApprovalBlock(completed)).toBeNull();
    expect(expireCallback(completed, pending.expiresAt)).toBe(completed);
    expect(reportCallback(completed, "failed", "other", pending.expiresAt)).toBe(completed);
  });

  it("rejects completion at the deadline even when expiry has not run", () => {
    expect(reportCallback(pending, "completed", "op", pending.expiresAt)).toEqual({
      ...pending,
      status: "expired",
      resolvedAt: pending.expiresAt,
    });
  });
});
