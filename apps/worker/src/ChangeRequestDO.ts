import {
  approve,
  AuthorityViolation,
  DEFAULT_POLICY,
  evaluate,
  type Approval,
  type ApprovalResult,
  type ChangeRequest,
  type Evaluation,
  type Policy,
  type Vendor,
} from "@pcc/domain";
import { DurableObject } from "cloudflare:workers";
import { createExtractor } from "./extraction/index.js";
import { diffClaims } from "./replay.js";
import type { Env } from "./index.js";

export type Status = "cooling_off" | "ready_for_review" | "approved" | "rejected";

interface StoredState {
  readonly request: ChangeRequest;
  readonly vendor: Vendor;
  readonly evaluation: Evaluation;
  /** The clock reading used at intake. Replay must reuse it, not "now". */
  readonly evaluatedAt: number;
  readonly status: Status;
  readonly approvals: ReadonlyArray<Approval>;
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
    ctx.blockConcurrencyWhile(async () => {
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

    if (request.method === "POST" && url.pathname === "/approve") {
      const body = await request.json<{ approverId: string; actor?: "human" | "model" }>();
      return this.handleApproval(body.approverId, body.actor ?? "human");
    }

    if (request.method === "POST" && url.pathname === "/replay") {
      const body = await request.json<{ extractor?: "stored" | "current" }>();
      return this.replay(body);
    }

    if (request.method === "GET" && url.pathname === "/state") {
      const state = await this.state();
      const events = this.ctx.storage.sql
        .exec<{ seq: number; at: number; type: string; payload: string | null }>(
          "SELECT seq, at, type, payload FROM events ORDER BY seq",
        )
        .toArray();
      return Response.json({ state, events });
    }

    return new Response("Not found", { status: 404 });
  }

  private async intake(input: { request: ChangeRequest; vendor: Vendor }): Promise<Response> {
    const now = Date.now();
    const evaluation = evaluate(input.request, input.vendor, now, this.policy());

    const state: StoredState = {
      request: input.request,
      vendor: input.vendor,
      evaluation,
      evaluatedAt: now,
      status: "cooling_off",
      approvals: [],
    };

    await this.ctx.storage.put("state", state);
    this.append("request.intake", {
      outcome: evaluation.outcome,
      reasons: evaluation.reasons.map((r) => r.code),
    });

    let status: Status = "cooling_off";
    if (now < evaluation.eligibleAt) {
      await this.ctx.storage.setAlarm(evaluation.eligibleAt);
      this.append("cooling_off.started", { until: evaluation.eligibleAt });
    } else {
      status = "ready_for_review";
      await this.ctx.storage.put("state", { ...state, status });
    }

    return Response.json({ status, evaluation });
  }

  private async handleApproval(
    approverId: string,
    actor: Approval["actor"],
  ): Promise<Response> {
    const state = await this.state();
    if (state === null) return new Response("No request", { status: 404 });

    const now = Date.now();
    const approvals = [...state.approvals, { actor, approverId, at: now }];

    let result: ApprovalResult;
    try {
      result = approve(state.evaluation, approvals, now, this.policy());
    } catch (error) {
      if (error instanceof AuthorityViolation) {
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
      throw error;
    }

    if (result.ok) {
      const next: StoredState = { ...state, approvals, status: "approved" };
      await this.ctx.storage.put("state", next);
      this.append("request.approved", { approverId });
      return Response.json({ ok: true, status: next.status });
    }

    const next: StoredState = { ...state, approvals };
    await this.ctx.storage.put("state", next);
    this.append("request.approval_rejected", { approverId, actor, reason: result.reason });
    return Response.json({ ok: false, reason: result.reason }, { status: 409 });
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

  /** Fires when the cooling-off period ends. Survives eviction, restarts, deploys. */
  override async alarm(): Promise<void> {
    const state = await this.state();
    if (state === null) return;

    const next: StoredState = { ...state, status: "ready_for_review" };
    await this.ctx.storage.put("state", next);
    this.append("cooling_off.elapsed", {});
  }
}
