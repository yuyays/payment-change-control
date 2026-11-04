# Handoff

State of this project as of 2026-11-04, so work can continue on another machine.

## The thesis

Most agent products put the model in charge and add guardrails afterwards. This inverts it:
**the harness is the accountability layer.** Every decision has exactly one owner, and the
system is built so the model has no path to the decision that matters.

Domain: **vendor bank-detail change verification** — a supplier emails "we changed our bank
account", which is the highest-loss decision in accounts payable. Fake payment-change emails
are a top source of finance losses, and every controller recognizes them.

## Why this domain, and not AP three-way match

Earlier candidate was AP three-way match. Rejected because the model's only job there is OCR —
everything else is joins and tolerance math, which reads as a rules engine with an LLM bolted on.
In this domain the model does the part code cannot (read a messy thread, spot pressure tactics,
extract claims) while code owns every check and a human owns approval.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers + Durable Objects | Cooling-off timer must survive eviction; one DO per request |
| Base | `effect-starter` monorepo | Kept `apps/web` + `packages/contracts`, replaced the Node API with a Worker |
| Model output | claims + verbatim quotes only | No verdict, no score, no offset, no approval |
| Anchoring | model supplies quotes, code finds offsets | Better than trusting model-supplied offsets |
| IBAN | ISO 13616 mod-97 | Found a truncated IBAN passing a shape check during smoke testing |
| Evals | two numbers: extraction accuracy, and system false-approve rate (= 0) | Proves the model can err while the system does not |

## What exists

```
packages/domain      pure TS — authority table, checks, anchor, evaluate, approve
  src/authority.ts   the ownership table, and the gate that throws
  src/evaluate.ts    outcome is only "reject" | "escalate" — there is no "approve"
  src/anchor.ts      quote -> offsets, with well-formedness checks
  src/checks.ts      domain similarity, verbatim citations, callback trust, cooling off, mod-97
apps/worker          Worker + ChangeRequestDO (SQLite events, alarm for cooling off)
  src/extraction/    strict schema, prompt, OpenAI-compatible client, offline regex fallback
apps/web             inherited from effect-starter, NOT yet wired to the new API
```

## Verified

- `pnpm typecheck` — 4/4 workspace projects
- `pnpm --filter @pcc/domain test` — 16 passed
- `pnpm --filter @pcc/worker test` — 7 passed
- `wrangler deploy --dry-run` — bundles, 12.6 KiB
- Live smoke test against the DO:
  - lookalike domain, untrusted callback, cooling-off all detected
  - model approval returns `403 authority_violation`
  - cooling-off alarm set at intake

## Next

1. **Evals** — 50 cases: ~18 legitimate, ~20 fraud, ~12 hard negatives. Two numbers:
   extraction/citation accuracy, and false-approve rate (must be 0 by construction).
2. **Fault injection** — a "compromised model" switch that emits `approve` plus the injected
   phone number; the harness must ignore both. Also: DO eviction during cooling off,
   duplicate approval, malformed JSON, fabricated citation.
3. **UI** — rewire `apps/web` from the starter's `users` example to change requests; render
   the authority table from the same config the gate enforces.
4. **Replay** — re-run a trace against recorded model outputs; diff two models.

## Traps to avoid

- Never let the model emit a risk score that drives the outcome.
- Do not copy the vendor master or the email corpus into the Durable Object; it holds session
  state only.
- The "compromised model" switch is fault injection — label it as such in the write-up or it
  reads as theater.

## Environment notes

- `minimumReleaseAge: 1440` blocks packages published in the last day. Pinned:
  `wrangler@4.156.2`, `@cloudflare/workers-types@5.20261102.1`, `tailwindcss@4.3.3`.
- Without `EXTRACTION_API_KEY` the offline regex extractor runs. With it, any
  OpenAI-compatible endpoint works.
