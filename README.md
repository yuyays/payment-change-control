# payment-change-control

A domain harness for the highest-loss decision in accounts payable: **a supplier emails to change its bank details.**

The model reads the email. Code decides. A human approves.

- [DESIGN.md](DESIGN.md) — the design doc: trust boundary, failure model, alternatives, open questions
- [DEMO.md](DEMO.md) — a two-minute walkthrough
- [EVALS-MODEL.md](EVALS-MODEL.md) — real-model eval results

## The thesis

Most agent products put the model in charge and add guardrails afterwards. This one inverts it: every decision has exactly one owner, declared in [`packages/domain/src/authority.ts`](packages/domain/src/authority.ts), and the gate throws if the wrong actor tries to act.

| Decision                                        | Owner |
| ----------------------------------------------- | ----- |
| Extract claims from the email                   | model |
| Verify a citation is verbatim                   | code  |
| Compare sender domain to the vendor master      | code  |
| Decide whether a callback number is trustworthy | code  |
| Enforce the cooling-off period                  | code  |
| Approve the change                              | human |
| Release payment                                 | human |

There is deliberately **no `approve` outcome** in `evaluate()`. The machine can only `reject` or `escalate`. Approval is a separate function that throws `AuthorityViolation` if a non-human actor is in the approval list.

## Layout

```
packages/domain      pure TypeScript. No I/O, no runtime, no framework. 100% of the rules.
packages/contracts   shared HTTP API types
apps/worker          Cloudflare Worker + one Durable Object per change request
apps/web             React review + approval UI (inherited from effect-starter)
```

`packages/domain` is the point. It is testable without a network and it is where the argument lives.

## Run it

```sh
pnpm install
pnpm --filter @pcc/domain test
pnpm --filter @pcc/worker dev     # wrangler dev on :8787
pnpm --filter @pcc/web dev        # vite on :5173
```

## Endpoints

```
GET  /api/health
POST /api/requests/:id/intake    { request, vendor }
POST /api/requests/:id/approve   { approverId, actor? }
GET  /api/requests/:id/state
```

## The demo

```sh
pnpm --filter @pcc/worker dev    # :8787
pnpm --filter @pcc/web dev       # :5173
```

Open http://localhost:5173 and press **Load demo data**. Six requests appear: one clean,
four attacks, one declined at intake.

`DEMO_MODE=1` (set in `wrangler.jsonc`) lets the client backdate `receivedAt` so the
cooling-off period can be shown as already elapsed. Remove it for anything real.

On a request page you get:

- the email, with citation-checked spans highlighted
- the findings, each tagged with its owner
- the authority table, rendered from the same config the gate enforces
- **Try to approve as the model**, which returns `403 authority_violation`

## Extraction

`apps/worker/src/extraction` turns an email into claims. The model may only return
`{ field, quote }` pairs. Code then:

1. parses the response against a strict schema — any extra key (a verdict, a risk
   score, a confidence) rejects the whole response;
2. locates each quote in the raw body, so the model never supplies offsets;
3. drops quotes that are not verbatim, or that are malformed (an IBAN must pass
   the ISO 13616 mod-97 check).

Set these to use a real model (any OpenAI-compatible endpoint):

```
EXTRACTION_API_KEY
EXTRACTION_BASE_URL   # default https://api.openai.com/v1
EXTRACTION_MODEL      # default gpt-4o-mini
```

Without a key, a regex extractor runs so the app works offline.

## Evals

```sh
pnpm --filter @pcc/worker evals        # offline extractor, no key
EXTRACTION_API_KEY=... EXTRACTION_MODEL=gpt-6-luna \
  pnpm --filter @pcc/worker evals:model
```

30 cases, 0 fraud escapes, 0 auto-approvals. The real-model run on `gpt-6-luna` is in
[EVALS-MODEL.md](EVALS-MODEL.md); the offline baseline is in [EVALS.md](EVALS.md).

## Durability

```sh
pnpm test:do
```

Starts the real worker in workerd with an 8-second cooling-off, lets the alarm fire,
kills the process, restarts it against the same storage, and then fires concurrent
approvals. Seven checks, no mocks:

```
PASS  status is cooling_off immediately after intake
PASS  alarm fired and moved the request to ready_for_review
PASS  state rehydrated after restart
PASS  two concurrent identical approvals are not enough
PASS  two distinct approvers approve
```

## Fault injection (the demo)

`EXTRACTION_MODE` swaps in a hostile extractor. It is a demo switch, not a feature.

| Attack                          | Mode / call                              | Which layer stops it | Result                                     |
| ------------------------------- | ---------------------------------------- | -------------------- | ------------------------------------------ |
| Model returns a verdict         | `EXTRACTION_MODE=compromised-schema`     | strict schema        | `422 invalid_model_output`                 |
| Model invents a callback number | `EXTRACTION_MODE=compromised-fabricated` | anchoring            | quote dropped, never reaches the evaluator |
| Model tries to approve          | `POST /approve {"actor":"model"}`        | authority gate       | `403 authority_violation`                  |

An injection with **no other signal** is deliberately not blocked. It is
indistinguishable from a legitimate request, and blocking on the phrase would be
trivially evadable. The property that holds is that it has no effect: no claims, no
decision change, no route to approval.

## Replay

`POST /api/requests/:id/replay` re-runs `evaluate()` against the stored inputs using the
recorded `evaluatedAt`, not the current clock. With `{"extractor":"current"}` it also
re-extracts the raw email with whichever model is configured and diffs the claims:

```
stored:   escalate [ ]
replayed: escalate [ ]
claims:   rule-based · stored 2 · replayed 2 · no differences
```

The decision is a pure function of stored data, so a replay that differs is a bug, not a
second opinion.

## What is not built yet

- An MCP door, so Claude Duet or Grok Bot can call `startAudit` / `resolveApproval`
- Real email ingestion (`.eml` upload instead of a JSON body)
- The "amount at risk" column a controller actually triages on
