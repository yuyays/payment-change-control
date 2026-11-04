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

The pattern has a name in the literature: **LLM-Modulo** — the model generates, an external
verifier disposes. See §11 for the rest of the pedigree.

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

| Decision                                        | Owner |
| ----------------------------------------------- | ----- |
| Extract claims from the email                   | model |
| Verify a citation is verbatim                   | code  |
| Compare sender domain to the vendor master      | code  |
| Decide whether a callback number is trustworthy | code  |
| Enforce the cooling-off period                  | code  |
| Approve the change                              | human |
| Release payment                                 | human |

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

| Code                      | Blocking | Meaning                                               |
| ------------------------- | -------- | ----------------------------------------------------- |
| `claim.citation.invalid`  | yes      | quote not present at the computed span                |
| `sender.domain.lookalike` | yes      | e.g. `acme-industria1.com` vs `acme-industrial.com`   |
| `sender.domain.mismatch`  | yes      | a different registrable domain                        |
| `replyTo.mismatch`        | yes      | Reply-To differs from the sender domain               |
| `callback.untrusted`      | yes      | the number came from the email, not the vendor master |
| `vendor.changed_recently` | no       | changed within 180 days                               |
| `cooling_off.pending`     | yes      | until `eligibleAt`                                    |

Domain comparison is deliberately simple and explainable: normalise, then lookalike if the
labels are equal without hyphens or within edit distance 1–2 on the same TLD. It is not a
homoglyph engine; that is future work.

## 8. Durability and concurrency

One Durable Object per change request. It owns the lifecycle, the approval list, and the
append-only event log.

- **Cooling off is an alarm**, not a cron and not a sleep. It survives eviction, restart, and
  deploy.
- **The event log is SQLite** inside the DO, written before the response is returned.
- **Approvals are serialised** by the object's single-threaded model: the approval handler reads
  state, computes, and writes with no `await` in between, so the read-modify-write is atomic
  today. This is safe by construction but fragile — a future callout between the read and the
  write would reopen the race and no test would catch it. `ctx.storage.transaction()` is the
  durable fix.
- **Replay uses the recorded clock** (`evaluatedAt`), not `Date.now()`, so re-running the
  decision is a determinism check rather than a second opinion.

Proven by `scripts/durability.sh`: real workerd, alarm fires, process killed, process restarted
against the same storage, state rehydrates, concurrent approvals behave.

## 9. Failure model

| Failure                                    | Behaviour                                                  |
| ------------------------------------------ | ---------------------------------------------------------- |
| Model returns malformed JSON               | 422, request not created                                   |
| Model returns a verdict                    | 422, whole response rejected                               |
| Model times out (60s)                      | 422, request not created                                   |
| Model quotes a fabricated number           | quote dropped by anchoring                                 |
| Model quotes a truncated IBAN              | dropped by mod-97                                          |
| Process dies during cooling off            | alarm fires after restart                                  |
| Duplicate approval click                   | distinct-approver count unchanged                          |
| Model calls `/approve` with `actor: model` | 403 `authority_violation`, event logged                    |
| Vendor record edited mid-flow              | state holds a snapshot; not yet re-checked (open question) |

## 10. Evals

30 cases: 10 legitimate, 11 fraud, 9 hard negatives.

| Metric                   | Value  |
| ------------------------ | ------ |
| Fraud escapes            | 0 / 11 |
| Auto-approvals           | 0      |
| Citation validity        | 100%   |
| IBAN recall              | 100%   |
| Legit approvable         | 100%   |
| Hard-negative approvable | 77.8%  |

The two safety numbers are not the same kind of claim:

- **auto-approvals = 0 is structural.** The evaluator has no such outcome, so it cannot regress
  without a type change.
- **fraud escapes = 0 is empirical.** It depends on the cases, and 11 is a small sample.

### What the numbers do not mean

Zero escapes in 11 fraud cases gives a 95% upper bound of roughly **10%** on the true escape
rate (the rule of three: 3/n). It is evidence that the pipeline catches the eleven attacks it
was shown — not evidence that it catches fraud in general. The honest claim is **"no observed
escapes in 30 cases."**

The next eval step is adversarial generation rather than more hand-written cases: mutate a
known-legitimate email one signal at a time and assert that the decision changes exactly when it
should, and at no other time.

The first real-model run scored **50% recall** because the model quoted the label with the
value. That was a domain bug, not a model bug, and the offline regex extractor could never have
exposed it. The fix (`extractWellFormed`) is described in §6.2.

## 11. Prior art

Nothing here is invented. It is a composition of patterns with long pedigrees, applied to one
workflow.

| Element                                   | Established name                        | Source                   |
| ----------------------------------------- | --------------------------------------- | ------------------------ |
| Model proposes, verifier disposes         | **LLM-Modulo**                          | Kambhampati et al., 2024 |
| An output type with no `approve` variant  | **make illegal states unrepresentable** | Minsky, 2010             |
| Validate at the boundary, carry the proof | **parse, don't validate**               | King, 2019               |
| Every action passes the gate              | **reference monitor**                   | Anderson, 1972           |
| Two distinct humans                       | **maker–checker / four-eyes**           | FFIEC, banking           |
| Safe even if the model is adversarial     | **AI control**                          | Greenblatt et al., 2023  |
| Untrusted input cannot trigger an action  | **CaMeL**, action-selector              | Debenedetti et al., 2025 |
| Least privilege over tool reach           | OWASP LLM06 **Excessive Agency**        | OWASP, 2025              |

### Products doing something similar

- **Kognitos** — markets the same split as "neurosymbolic": LLM for understanding, deterministic
  engine for rules.
- **MightyBot** — policy compiled to a deterministic DAG; "a model cannot skip a required check,
  because the check is a step in the plan rather than a suggestion in a prompt."
- **Palantir AIP** — deterministic functions, runtime validations, and per-action authorization
  grants.
- **Botminds** — sealed agent witnesses plus a "verdict clerk" that never decides, applied to
  this exact workflow.
- **Trustpair** — bank-account _ownership_ verification, and an explicit argument against
  letting AI make the call.

### What is not novel, and what is

Not novel: code deciding, a human approving, citations, and an audit trail. Every serious vendor
in this market separates detection from verification from approval.

Unusual: refusing the model a **verdict** at the type level, and assigning authority per
_decision_ rather than per _tool_. I could not find a product that documents either. That is
either ahead of the market or unnecessary, and this project cannot tell you which.

### The counter-position

Coupa ships an agent that reads a forged bank letter and returns "74% risk, 13 signals,
recommended Reject." Their CISO's position is that this is _a signal to confirm, not a
substitute for confirming_, and that every change needs out-of-band human confirmation — but
they still let the model rank.

The argument for: a ranked signal helps a human triage, and a binary block does not. The
argument against: a score invites deference. This design takes the second position. That is a
bet, not a proof.

## 12. Alternatives considered

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

## 13. Open questions

1. **Ownership, not syntax.** mod-97 proves an IBAN is well-formed. It does not prove the supplier
   owns the account. Trustpair and Bottomline ask the bank; this design asks nobody. This is the
   largest functional gap in the system.
2. **Does the human actually check?** The approval gate is unmeasured. Override rate, time on
   task, and whether the approver opened the citations are the numbers that would tell you
   whether oversight is real or a moral crumple zone. Right now the design cannot distinguish
   between the two.
3. **Vendor master drift.** The DO holds a snapshot of the vendor at intake. If the vendor is
   edited during cooling off, the decision is made against stale data. The alarm should
   re-validate against the live master.
4. **Override.** A legitimate post-acquisition domain change is blocked forever. Operations need
   a documented, audited override ("we called the number on file and confirmed"). That is a new
   authority row, not a flag.
5. **Lookalike detection.** Edit distance misses homoglyphs and punycode. This needs a real
   normalisation step before it can be trusted.
6. **The eval set.** 30 cases written by the author measure the pipeline, not the world. See §10
   for what the numbers do and do not support.
7. **Amount at risk.** Nothing in the system knows how much money is exposed, which is what a
   controller actually triages on.

## 14. Risks

- **The "should we verify?" judgment is the product.** Code blocks; humans decide. If customers
  want straight-through processing, this design is the wrong shape for them.
- **A blocked request is not a safe request.** The system refuses to proceed; it does not stop a
  payment elsewhere in the stack.
- **Model cost is per-request and unbounded** by anything except the per-call timeout.
- **The human gate can become theater.** A reviewer handed a clean, pre-validated packet is a
  candidate for automation bias. The design currently has no way to tell a real check from a
  rubber stamp.

## Appendix: layout

```
packages/domain      pure TS — authority, checks, anchor, evaluate. 19 tests.
apps/worker          Worker + ChangeRequestDO + extraction. 16 tests.
apps/web             React review packet, approval panel, replay.
scripts/durability.sh  real-workerd durability proof.
EVALS.md / EVALS-MODEL.md  eval reports.
```
