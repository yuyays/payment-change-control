# Architecture rules

## The layering

- `packages/domain` is pure. No `fetch`, no `Date.now()` outside a parameter, no Cloudflare imports,
  no Effect. If it needs I/O it does not belong here.
- `apps/worker` is the only place that mutates state. One Durable Object per change request.
- `apps/web` renders; it never decides.

## Authority

- Every new decision must be added to `AUTHORITY` in `packages/domain/src/authority.ts` with an owner.
- Call `assertAuthority(action, actor)` immediately before the side effect, not at the call site.
- The model's output type may not carry a verdict, a score, or an approval. It carries claims and citations.

## Citations

- A model claim is valid only if `rawBody.slice(start, end) === quote`.
- Invalid claims are dropped and logged. They are never shown with a warning.
- Anything extracted from an untrusted email is untrusted input and cannot become a callback number,
  a bank account, or a recipient address without matching the vendor master.

## Durability

- The cooling-off timer is a Durable Object alarm. It must survive eviction, restart and deploy.
- State transitions are recorded in the `events` table before the response is returned.
- Side effects carry an idempotency key.

## Testing

- Domain rules: unit tests, no mocks.
- Failure injection lives in `apps/worker`: bad JSON, fabricated citation, model-approves,
  duplicate approval.
- `scripts/durability.sh` proves the alarm and persistence against real workerd. It restarts
  the process mid-flow; keep it passing.
