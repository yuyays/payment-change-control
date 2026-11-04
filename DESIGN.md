# Design: Payment Change Control

Status: implemented, not deployed · 2026-11-04

A domain harness for one decision: **a supplier emails asking to change its bank details.**

The model reads the email. Code decides. A human approves.

---

## 1. Problem

Accounts payable teams receive emails that say "please update our bank account". Most are
routine. Some are fraud, and the fraud is cheap to run: register a lookalike domain, copy the
supplier's signature, ask for the change, and wait for the next payment.

The control that exists in most companies is a policy document and a worried clerk. It fails
for three reasons:

1. **The evidence is unstructured.** The request lives in an email thread; the truth lives in
   the vendor master.
2. **The decision is binary but the risk is not.** "Approve" and "reject" hide the interesting
   case: plausible but unverified.
3. **The clock matters.** A change made today only hurts at the next payment run, which is the
   one thing that gives you time to verify — if the system forces you to use it.

This is a good agent problem only if the model is kept away from the decision. That constraint
is the design.

## 2. Thesis

> The harness is the accountability layer, not a capability patch.

Most agent products put the model in charge and add guardrails afterwards. This inverts it:
every decision has exactly one owner, declared in code, and the model has **no code path** to
the decision that matters.

This is stronger than "the prompt says don't". A prompt is an instruction; a type is a
constraint. `evaluate()` cannot return `approve` because the type has no such variant.

## 3. Non-goals

- Multi-tenancy, billing, SSO. This is a single-domain harness, not a SaaS.
- Email ingestion from a real mailbox. The raw body arrives in a JSON request.
- Actually moving money. Approval ends at a status, not a payment.
- Being a framework. It is one worked example, deliberately narrow.

## 4. Domain model

```
Vendor            registeredDomain, phoneOnFile, bankAccount, lastBankChangeAt
ChangeRequest     rawBody, fromAddress, replyTo, receivedAt, extraction
Extraction        claims[] — the only thing the model contributes
Claim             field (bankName | iban | callbackPhone), value, citation
Citation          quote, start, end
Evaluation        outcome (reject | escalate), reasons[], validClaims[], eligibleAt
Reason            code, detail, owner, blocking
Approval          actor, approverId, at
```

A request moves through:

```
intake ──▶ cooling off (48h) ──▶ human review ──▶ approved
   │                               │
   └──▶ rejected (structurally unverifiable)     └──▶ more findings, still pending
```

There is no automatic approval state. The best a request can reach without a human is
`ready_for_review`.

## 5. Authority

`packages/domain/src/authority.ts` is the single source of truth:

| Decision | Owner |
| --- | --- |
| Extract claims from the email | model |
| Verify a citation is verbatim | code |
| Compare sender domain to the vendor master | code |
| Decide whether a callback number is trustworthy | code |
| Enforce the cooling-off period | code |
| Approve the change | human |
| Release payment | human |

`assertAuthority(action, actor)` throws `AuthorityViolation` when the wrong actor acts. The UI
renders the same exported table, so what is on screen is what is enforced — there is no second
copy to drift.

**Why the table matters more than the prompt:** it survives model upgrades. A better model
changes nothing about who is allowed to decide; it only changes how many requests reach a human
with a clean file.

## 6. Trust boundary

Three independent layers, each able to stop a request on its own.

### 6.1 Schema

The model's response may contain exactly one key, `claims`, and each claim exactly `field` and
`quote`. Anything else — `decision`, `risk`, `confidence` — rejects the **entire** response. We
do not salvage the claims from a response that tried to decide.

### 6.2 Anchoring

The model supplies **quotes, not offsets**. Code locates the quote in the email:

```
rawBody.indexOf(quote) !== -1
```

A fabricated or paraphrased quote cannot be anchored, because it is not in the source. The
citation is then recomputed from the actual location, so the highlighted span in the UI is
always a literal slice of the email.

When the quote includes a label (`"New IBAN: DE89 …"`), the span is still trusted, and a
well-formed token is extracted **from inside it**. The value remains a slice of the email.

### 6.3 Well-formedness

A quote that exists can still be useless. A truncated IBAN looks authoritative and cannot be
paid. So:

- IBAN must pass ISO 13616 mod-97;
- phone numbers must be 7–15 digits;
- bank names must be non-empty.

Invalid claims are **dropped and logged**, never shown with a warning. A warning invites a
human to click through it.

### What this buys

A prompt injection in the email has no effect — not because the model resisted it, but because
the injection produces no claims, changes no decision, and has no route to approval. The test
suite asserts this as `hn-injection-alone`.

## 7. Deterministic checks

| Code | Blocking | Meaning |
| --- | --- | --- |
| `claim.citation.invalid` | yes | quote not present at the computed span |
| `sender.domain.lookalike` | yes | e.g. `acme-industria1.com` vs `acme-industrial.com` |
| `sender.domain.mismatch` | yes | a different registrable domain |
| `replyTo.mismatch` | yes | Reply-To differs from the sender domain |
| `callback.untrusted` | yes | the number came from the email, not the vendor master |
| `vendor.changed_recently` | no | changed within 180 days |
| `cooling_off.pending` | yes | until `eligibleAt` |

Domain comparison is deliberately simple and explainable: normalise, then lookalike if the
labels are equal without hyphens or within edit distance 1–2 on the same TLD. It is not a
homoglyph engine; that is future work.

## 8. Durability and concurrency

One Durable Object per change request. It owns the lifecycle, the approval list, and the
append-only event log.

- **Cooling off is an alarm**, not a cron and not a sleep. It survives eviction, restart, and
  deploy.
- **The event log is SQLite** inside the DO, written before the response is returned.
- **Approvals are serialised** by the object's single-threaded model. Two concurrent clicks
  cannot both become the "second" approval.
- **Replay uses the recorded clock** (`evaluatedAt`), not `Date.now()`, so re-running the
  decision is a determinism check rather than a second opinion.

Proven by `scripts/durability.sh`: real workerd, alarm fires, process killed, process restarted
against the same storage, state rehydrates, concurrent approvals behave.

## 9. Failure model

| Failure | Behaviour |
| --- | --- |
| Model returns malformed JSON | 422, request not created |
| Model returns a verdict | 422, whole response rejected |
| Model times out (60s) | 422, request not created |
| Model quotes a fabricated number | quote dropped by anchoring |
| Model quotes a truncated IBAN | dropped by mod-97 |
| Process dies during cooling off | alarm fires after restart |
| Duplicate approval click | distinct-approver count unchanged |
| Model calls `/approve` with `actor: model` | 403 `authority_violation`, event logged |
| Vendor record edited mid-flow | state holds a snapshot; not yet re-checked (open question) |

## 10. Evals

30 cases: 10 legitimate, 11 fraud, 9 hard negatives. Two numbers matter:

- **fraud escapes** — must be 0. No fraudulent request reaches an approvable state.
- **auto-approvals** — must be 0. There is no such outcome to reach.

Latest real-model run (`gpt-6-luna`, see `EVALS-MODEL.md`):

| Metric | Value |
| --- | --- |
| Fraud escapes | 0 / 11 |
| Auto-approvals | 0 |
| Citation validity | 100% |
| IBAN recall | 100% |
| Legit approvable | 100% |
| Hard-negative approvable | 77.8% |

The first real-model run scored **50% recall** because the model quoted the label with the
value. That was a domain bug, not a model bug, and the offline regex extractor could never have
exposed it. The fix (`extractWellFormed`) is described in §6.2.

## 11. Alternatives considered

**AP three-way match** — rejected. Richer deterministic core, but the model's only job is OCR;
everything else is joins and tolerance maths. It reads as a rules engine with an LLM bolted on,
which is the exact impression this project exists to avoid.

**Expense pre-audit** — closest runner-up. Good citation story, but the demo moment is weaker:
"the validator rejected a claim" is less visceral than "I attacked my own agent and nothing
happened".

**Temporal instead of Durable Objects** — Temporal is the stronger tool for multi-day
business processes with retries across many systems, but it is a cluster to run. The only
durable requirement here is one timer and one serialised decision. A DO is the smaller correct
tool. If this grew to orchestrate remediation across five systems, that trade flips.

**Claude Managed Agents / the Agents SDK** — would have removed the runtime work and the
learning. The runtime is now commodity; the domain rules and the evidence are the product.
Using the SDK would have hidden the layer this project is demonstrating.

## 12. Open questions

1. **Vendor master drift.** The DO holds a snapshot of the vendor at intake. If the vendor is
   edited during cooling off, the decision is made against stale data. Should the alarm
   re-validate against the live master?
2. **Override.** A legitimate post-acquisition domain change is currently blocked forever. Real
   operations need a documented, audited override ("we called the number on file and confirmed").
   That is a new authority row, not a flag.
3. **Lookalike detection.** Edit distance misses homoglyphs and punycode. This needs a real
   normalisation step before it can be trusted.
4. **The eval set.** 30 cases written by the author measure the pipeline, not the world. Real
   AP inboxes are the only source that would make these numbers mean something.
5. **Amount at risk.** Nothing in the system knows how much money is exposed, which is what a
   controller actually triages on.

## 13. Risks

- **The "should we verify?" judgment is the product.** Code blocks; humans decide. If customers
  want straight-through processing, this design is the wrong shape for them.
- **A blocked request is not a safe request.** The system refuses to proceed; it does not stop a
  payment elsewhere in the stack.
- **Model cost is per-request and unbounded** by anything except the per-call timeout.

## Appendix: layout

```
packages/domain      pure TS — authority, checks, anchor, evaluate. 19 tests.
apps/worker          Worker + ChangeRequestDO + extraction. 16 tests.
apps/web             React review packet, approval panel, replay.
scripts/durability.sh  real-workerd durability proof.
EVALS.md / EVALS-MODEL.md  eval reports.
```
