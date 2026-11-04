# The model can't say yes

_Draft. ~900 words._

---

I built a system where a language model reads a supplier's email asking to change a bank
account, and the model is not allowed to decide anything.

Not "is instructed not to". Not "is evaluated and flagged". Its output type has no field for a
verdict, no score, and no approval. If it returns one anyway, the entire response is rejected.
The function that approves a change cannot be called by a model at all — it throws.

The interesting part turned out not to be the constraint. It was what the evals found once I
stopped testing the model and started testing the system.

## The shape

Accounts payable teams get emails like "please update our bank details". Most are routine. Some
are fraud, and the fraud is cheap: register a lookalike domain, copy the signature, wait for the
next payment run.

The control is usually a policy document and a worried clerk. Three things go wrong. The evidence
is unstructured. The decision is binary while the risk is not. And the 48 hours before the next
payment run — the one window you have to verify — is usually spent on something else.

So the system splits the work three ways. The model extracts claims from the email: bank name,
IBAN, callback number — as verbatim quotes only. Code validates those quotes, checks the sender
domain against the vendor master, checks that the callback number matches the one on file, and
enforces a cooling-off period. Two humans approve.

Three gates, each able to stop the request on its own:

- **Schema.** The response may contain exactly one key, `claims`. Anything else rejects the whole
  thing. I don't salvage claims from a response that tried to decide.
- **Anchoring.** The model supplies quotes, not offsets. The server finds the quote in the email.
  A fabricated quote can't be anchored, because it isn't in the source.
- **Well-formedness.** A quote that exists can still be useless. An IBAN must pass the ISO 13616
  mod-97 checksum; a truncated one looks authoritative and can't be paid.

Plus a fourth thing that took a while to get right: an authority table that assigns every
decision to model, code, or human, and a gate that throws when the wrong actor acts.

## The first eval found a bug in my design

I wrote 30 cases: 10 legitimate, 11 fraud, 9 hard negatives. On the offline regex extractor,
everything passed. Zero fraud escapes, 100% citation validity, 100% recall.

Then I ran the same cases against a real model and got **50% recall**.

The model wasn't worse at reading. It was quoting the label with the value:

```json
{ "field": "iban", "quote": "New IBAN: FR14 2004 1010 0505 0001 3M02 606" }
```

The quote is verbatim, so anchoring found it. But the span isn't an IBAN, so the well-formedness
check dropped it. A regex never makes that mistake, because a regex never quotes context.

The fix was a day of work and it was in the domain, not the prompt: keep the verbatim span, then
extract a well-formed token from inside it. The value is still a literal slice of the email. Recall
went back to 100%, and the case that exposed it is now in the suite.

That is the argument for evaluating the system rather than the model. The offline extractor could
never have found it. The bug only exists because a component with judgment was involved.

## The second eval found a worse bug

Then I wrote an adversarial generator: take each legitimate case, change one signal, assert the
decision changes exactly when it should. Lookalike domain, foreign domain, Reply-To mismatch,
attacker callback, truncated IBAN, bad checksum. And the inverse: injection, urgency, lowercase,
add the on-file phone — all of which must _not_ change the decision.

100 mutations. The first run had 16 failures, all one bug.

Corrupt the IBAN in an email that also contains the phone number already on file, and the request
stayed **approvable**. One valid `callbackPhone` claim was enough to reach "escalate", and nothing
required a bank account to be present. A human could have approved a change with no account to
change.

The curated set never caught this because no curated case combined a bad IBAN with a good phone
number. I didn't think of it. The generator did.

Fixed with a rule: no valid IBAN or bank name, no approval.

## What I think now

The model is not the interesting part of this system. The boundary is.

Every check that matters — domain, callback, checksum, cooling-off, two distinct approvers — is
deterministic. The model's contribution is turning a messy email into citations. That is real
work, and it's the part I couldn't write with regexes. But it's also the part that gets _easier_
every year, while the boundary gets more important.

Which is why the constraint is not "the model is too dumb to decide". It's that the model is not
the party accountable for the decision. The type encodes that, so a model upgrade can't quietly
change who is liable.

## The open question

There's a real disagreement here, and I don't have the evidence to settle it.

Coupa ships an agent that reads a forged bank letter and returns "74% risk, 13 signals, recommend
Reject". Their CISO's position is that this is a signal to confirm, not a substitute for
confirming — and that every change needs out-of-band human confirmation, including the ones that
pass. But they still let the model rank.

The argument for: a ranked signal helps a human triage, and a binary block doesn't. The argument
against: a score primes the reviewer, and a pre-validated packet invites a rubber stamp.

My system records how many citations each approver opened and how long they spent. That's a
proxy, not proof. The actual question is whether reviewers who see evidence without a score catch
more fraud, or just take longer. I haven't tested it.

## What this isn't

30 cases bounds the escape rate at roughly 10%, not zero. The IBAN check proves syntax, not
ownership — Trustpair and Bottomline ask the bank, and I ask nobody. There are no real emails, no
users, and no monitoring.

What there is: a working vertical slice, a design doc that admits its limits, a durability test
that kills the process and checks the state survives, and two bugs that only appeared because the
evals were adversarial.

The repo is [here](#). The design doc has the parts I got wrong.
