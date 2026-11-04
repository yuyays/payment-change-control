# payment-change-control

A domain harness for the highest-loss decision in accounts payable: **a supplier emails to change its bank details.**

The model reads the email. Code decides. A human approves.

## The thesis

Most agent products put the model in charge and add guardrails afterwards. This one inverts it: every decision has exactly one owner, declared in [`packages/domain/src/authority.ts`](packages/domain/src/authority.ts), and the gate throws if the wrong actor tries to act.

| Decision | Owner |
| --- | --- |
| Extract claims from the email | model |
| Verify a citation is verbatim | code |
| Compare sender domain to the vendor master | code |
| Decide whether a callback number is trustworthy | code |
| Enforce the cooling-off period | code |
| Approve the change | human |
| Release payment | human |

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

## What is not built yet

- The eval suite and the "compromised model" fault-injection switch
- The UI rewiring from the starter's `users` example
- Replay from the event log
