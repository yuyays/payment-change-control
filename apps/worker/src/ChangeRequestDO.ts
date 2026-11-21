import {
  approve,
  assertAuthority,
  callbackApprovalBlock,
  createCallback,
  expireCallback,
  reportCallback,
  vendorChanges,
  AuthorityViolation,
  DEFAULT_POLICY,
  evaluate,
  type Approval,
  type ApprovalResult,
  type CallbackChallenge,
  type ChangeRequest,
  type Evaluation,
  type Policy,
  type Vendor,
} from "@pcc/domain";
import { DurableObject } from "cloudflare:workers";
import { createExtractor } from "./extraction/index.js";
import { readVendorMaster } from "./vendor-master.js";
import { diffClaims } from "./replay.js";
import type { ReviewEvidence } from "./review-evidence.js";
import type { Env } from "./index.js";

export type Status = "cooling_off" | "ready_for_review" | "approved" | "rejected" | "invalidated";

interface StoredState {
  readonly request: ChangeRequest;
  readonly vendor: Vendor;
  readonly evaluation: Evaluation;
  /** The clock reading used at intake. Replay must reuse it, not "now". */
  readonly evaluatedAt: number;
  readonly status: Status;
  readonly approvals: ReadonlyArray<Approval>;
  /** Absent on requests created before callback verification was introduced. */
  readonly callback?: CallbackChallenge;
  readonly invalidationReason?: "vendor.changed_mid_flow";
  /** What each approver did before deciding. Telemetry, not a decision input. */
  readonly evidence: ReadonlyArray<ReviewEvidence>;
}

/**
 * One Durable Object per change request.
 *
 * It owns the lifecycle: intake -> cooling off -> human review -> approved.
 * The model never writes to this object's decision fields; it only supplies
 * an `ExtractedEmail`, which the domain layer checks first.
 */
export class ChangeRequestDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          seq     INTEGER PRIMARY KEY AUTOINCREMENT,
          at      INTEGER NOT NULL,
          type    TEXT NOT NULL,
          payload TEXT
        )
      `);
    });
  }

  private append(type: string, payload: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO events (at, type, payload) VALUES (?, ?, ?)",
      Date.now(),
      type,
      JSON.stringify(payload),
    );
  }

  private async state(): Promise<StoredState | null> {
    return (await this.ctx.storage.get<StoredState>("state")) ?? null;
  }

  /** The cooling-off period is 48h in production. Tests can shorten it. */
  private policy(): Policy {
    const seconds = Number(this.env.COOLING_OFF_SECONDS ?? "");
    if (Number.isFinite(seconds) && seconds > 0) {
      return { ...DEFAULT_POLICY, coolingOffHours: seconds / 3600 };
    }
    return DEFAULT_POLICY;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/intake") {
      return this.intake(await request.json<{ request: ChangeRequest; vendor: Vendor }>());
    }

    if (request.method === "POST" && url.pathname === "/callback") {
      return this.handleCallback(await request.json().catch(() => null));
    }

    if (request.method === "POST" && url.pathname === "/approve") {
      const body = await request.json<{
        approverId: string;
        actor?: "human" | "model";
        evidence?: { citationsOpened: number; dwellMs: number };
      }>();
      return this.handleApproval(body.approverId, body.actor ?? "human", body.evidence);
    }

    if (request.method === "POST" && url.pathname === "/replay") {
      const body = await request.json<{ extractor?: "stored" | "current" }>();
      return this.replay(body);
    }

    if (request.method === "GET" && url.pathname === "/state") {
      return this.ctx.storage.transaction(async () => {
        const state = await this.currentState(Date.now());
        const events = this.ctx.storage.sql
          .exec<{ seq: number; at: number; type: string; payload: string | null }>(
            "SELECT seq, at, type, payload FROM events ORDER BY seq",
          )
          .toArray();
        return Response.json({ state, events });
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async intake(input: { request: ChangeRequest; vendor: Vendor }): Promise<Response> {
    let vendor: Vendor;
    try {
      vendor = await readVendorMaster(this.env.VENDOR_MASTER, input.request.vendorId);
    } catch {
      return Response.json({ error: "vendor_master_unavailable" }, { status: 503 });
    }
    const now = Date.now();
    const evaluation = evaluate(input.request, vendor, now, this.policy());

    const callback = createCallback(vendor.phoneOnFile, now);
    const state: StoredState = {
      request: input.request,
      vendor,
      evaluation,
      evaluatedAt: now,
      status: "cooling_off",
      approvals: [],
      evidence: [],
      callback,
    };

    const created = await this.ctx.storage.transaction(async () => {
      // The request ID is the idempotency key; re-intake cannot reset callback evidence.
      if ((await this.state()) !== null) return false;
      assertAuthority("check.vendorSnapshot", "code");
      assertAuthority("callback.create", "code");
      await this.ctx.storage.put("state", state);
      this.append("request.intake", {
        outcome: evaluation.outcome,
        reasons: evaluation.reasons.map((r) => r.code),
      });
      this.append("callback.created", callback);
      await this.scheduleAlarm(state, evaluation.eligibleAt);
      if (now < evaluation.eligibleAt) {
        this.append("cooling_off.started", { until: evaluation.eligibleAt });
      }
      return true;
    });
    if (!created) return Response.json({ error: "request_already_exists" }, { status: 409 });

    if (now >= evaluation.eligibleAt) await this.alarm();
    return Response.json({
      status: (await this.state())?.status ?? state.status,
      evaluation,
      callback,
    });
  }

  /** Invoked within a storage transaction; a delayed alarm cannot extend the deadline. */
  private async currentState(now: number): Promise<StoredState | null> {
    const state = await this.state();
    if (state === null || state.callback === undefined) return state;
    const callback = expireCallback(state.callback, now);
    if (callback === state.callback) return state;

    const next = { ...state, callback };
    assertAuthority("callback.expire", "code");
    await this.ctx.storage.put("state", next);
    this.append("callback.expired", callback);
    return next;
  }

  private async scheduleAlarm(state: StoredState, coolingAt = Infinity): Promise<void> {
    const expiresAt = state.callback?.status === "pending" ? state.callback.expiresAt : Infinity;
    const wakeAt = Math.min(coolingAt, expiresAt);
    if (Number.isFinite(wakeAt)) await this.ctx.storage.setAlarm(wakeAt);
  }

  private async handleCallback(body: unknown): Promise<Response> {
    if (
      typeof body !== "object" ||
      body === null ||
      !("operatorId" in body) ||
      typeof body.operatorId !== "string" ||
      body.operatorId.trim() === "" ||
      body.operatorId.length > 128 ||
      !("outcome" in body) ||
      (body.outcome !== "completed" && body.outcome !== "failed") ||
      !("actor" in body) ||
      (body.actor !== "human" && body.actor !== "model" && body.actor !== "code")
    ) {
      return Response.json({ error: "invalid_callback_report" }, { status: 400 });
    }
    const { actor, outcome } = body;
    const operatorId = body.operatorId.trim();
    return this.ctx.storage.transaction(async () => {
      const now = Date.now();
      const state = await this.currentState(now);
      if (state === null) return Response.json({ error: "no_request" }, { status: 404 });

      try {
        assertAuthority("callback.report", actor);
        const current = state.callback;
        if (current === undefined) {
          return Response.json({ error: "callback.missing" }, { status: 409 });
        }
        // The request ID plus the single terminal outcome makes identical retries safe.
        if (current.status === outcome && current.operatorId === operatorId) {
          return Response.json({ callback: current });
        }
        if (current.status !== "pending") {
          return Response.json({ error: `callback.${current.status}` }, { status: 409 });
        }
        if (state.status !== "cooling_off" && state.status !== "ready_for_review") {
          return Response.json({ error: state.status }, { status: 409 });
        }

        const callback = reportCallback(current, outcome, operatorId, now);
        assertAuthority("callback.report", actor);
        await this.ctx.storage.put("state", { ...state, callback });
        this.append(`callback.${callback.status}`, callback);
        return Response.json({ callback });
      } catch (error) {
        if (error instanceof AuthorityViolation) return this.authorityFailure(error);
        throw error;
      }
    });
  }

  private authorityFailure(error: AuthorityViolation): Response {
    this.append("authority.violation", {
      action: error.action,
      expected: error.expected,
      actual: error.actual,
    });
    return Response.json(
      { ok: false, error: "authority_violation", action: error.action, expected: error.expected },
      { status: 403 },
    );
  }

  private async handleApproval(
    approverId: string,
    actor: Approval["actor"],
    review?: { readonly citationsOpened: number; readonly dwellMs: number },
  ): Promise<Response> {
    return this.ctx.storage.transaction(async () => {
      const now = Date.now();
      const state = await this.currentState(now);
      if (state === null) return new Response("No request", { status: 404 });

      const approvals = [...state.approvals, { actor, approverId, at: now }];
      const evidence =
        review === undefined
          ? state.evidence
          : [
              ...state.evidence,
              {
                approverId,
                citationsOpened: Math.max(0, Math.floor(review.citationsOpened)),
                dwellMs: Math.max(0, Math.floor(review.dwellMs)),
                at: now,
              },
            ];

      let result: ApprovalResult;
      try {
        assertAuthority("decide.approveChange", actor);
        // The clock alone is not enough: the alarm must have revalidated the master.
        if (state.status !== "ready_for_review") {
          assertAuthority("check.reviewReadiness", "code");
          this.append("request.approval_rejected", {
            approverId,
            actor,
            reason: state.invalidationReason ?? state.status,
          });
          return Response.json(
            { ok: false, reason: state.invalidationReason ?? state.status },
            { status: 409 },
          );
        }

        const callbackBlock = callbackApprovalBlock(state.callback);
        if (callbackBlock !== null) {
          assertAuthority("check.callbackCompletion", "code");
          this.append("request.approval_rejected", { approverId, actor, reason: callbackBlock });
          return Response.json({ ok: false, reason: callbackBlock }, { status: 409 });
        }

        result = approve(state.evaluation, approvals, now, this.policy());
      } catch (error) {
        if (error instanceof AuthorityViolation) return this.authorityFailure(error);
        throw error;
      }

      if (result.ok) {
        const next: StoredState = { ...state, approvals, evidence, status: "approved" };
        assertAuthority("decide.approveChange", actor);
        await this.ctx.storage.put("state", next);
        this.append("request.approved", { approverId });
        return Response.json({ ok: true, status: next.status });
      }

      const next: StoredState = { ...state, approvals, evidence };
      assertAuthority("decide.approveChange", actor);
      await this.ctx.storage.put("state", next);
      this.append("request.approval_rejected", { approverId, actor, reason: result.reason });
      return Response.json({ ok: false, reason: result.reason }, { status: 409 });
    });
  }

  /**
   * Re-run the decision from stored inputs, and optionally re-extract with the
   * current model. The clock is the recorded `evaluatedAt`, not now, so the
   * replay is a real determinism check rather than a second opinion.
   */
  private async replay(input: { extractor?: "stored" | "current" }): Promise<Response> {
    const state = await this.state();
    if (state === null) return new Response("No request", { status: 404 });

    const evaluatedAt = state.evaluatedAt ?? state.request.receivedAt;
    const replayed = evaluate(state.request, state.vendor, evaluatedAt, this.policy());

    const codes = (evaluation: Evaluation): ReadonlyArray<string> =>
      evaluation.reasons.map((reason) => reason.code).sort();

    const same =
      replayed.outcome === state.evaluation.outcome &&
      codes(replayed).join("|") === codes(state.evaluation).join("|");

    let claims = null;
    if (input.extractor === "current") {
      const extractor = createExtractor(this.env);
      const outcome = await extractor.extract({
        rawBody: state.request.rawBody,
        fromAddress: state.request.extraction.fromAddress,
        replyTo: state.request.extraction.replyTo,
      });
      claims = {
        extractor: outcome.provider,
        stored: state.evaluation.validClaims.length,
        replayed: outcome.extraction.claims.length,
        diff: diffClaims(state.evaluation.validClaims, outcome.extraction.claims),
      };
    }

    this.append("request.replayed", { same, extractor: input.extractor ?? "stored" });

    return Response.json({
      decision: {
        same,
        evaluatedAt,
        stored: { outcome: state.evaluation.outcome, reasons: codes(state.evaluation) },
        replayed: { outcome: replayed.outcome, reasons: codes(replayed) },
      },
      claims,
    });
  }

  /** One persistent alarm wakes for cooling-off, master retries, or callback expiry. */
  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.transaction(async () => {
      const now = Date.now();
      const current = await this.currentState(now);
      if (current === null) return null;
      if (current.status !== "cooling_off") {
        await this.scheduleAlarm(current);
        return null;
      }
      if (now < current.evaluation.eligibleAt) {
        await this.scheduleAlarm(current, current.evaluation.eligibleAt);
        return null;
      }
      return current;
    });
    if (state === null) return;

    let current: Vendor | undefined;
    try {
      current = await readVendorMaster(this.env.VENDOR_MASTER, state.request.vendorId);
    } catch {
      // Keep pending until an operator restores the master; never release on read failure.
    }

    // KV reads yield. Preserve any callback outcome recorded during revalidation.
    await this.ctx.storage.transaction(async () => {
      const now = Date.now();
      const latest = await this.currentState(now);
      if (latest === null || latest.status !== "cooling_off") return;
      if (current === undefined) {
        assertAuthority("check.vendorRevalidationRetry", "code");
        this.append("vendor.revalidation_failed", { vendorId: state.request.vendorId });
        await this.scheduleAlarm(latest, now + 60_000);
        return;
      }

      const changedFields = vendorChanges(state.vendor, current);
      const next: StoredState =
        changedFields.length > 0
          ? { ...latest, status: "invalidated", invalidationReason: "vendor.changed_mid_flow" }
          : { ...latest, status: "ready_for_review" };
      assertAuthority("check.vendorRevalidation", "code");
      await this.ctx.storage.put("state", next);
      this.append("vendor.revalidated", { vendorId: state.request.vendorId, changedFields });
      if (next.status === "invalidated") {
        this.append("vendor.changed_mid_flow", { changedFields });
      } else {
        this.append("cooling_off.elapsed", {});
      }
      await this.scheduleAlarm(next);
    });
  }
}
