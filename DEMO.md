# Demo script

Two minutes. One sentence, one attack, one approval.

## Before you start

```sh
pnpm --filter @pcc/worker dev    # :8787
pnpm --filter @pcc/web dev       # :5173
```

Open `http://localhost:5173` and press **Load demo data**. Six requests appear.

## The run

### 0:00 — The one sentence

> "This is a harness for one decision in accounts payable: a supplier emails asking to change
> its bank account. Most are routine, some are fraud. The model reads the email, code decides,
> a human approves."

### 0:10 — The attack

Click **Urgent bank change**.

Point at the email:

> "Lookalike domain — `acme-industria1.com` with a one. A callback number supplied by the
> attacker. And a line addressed to an AI assistant telling it to mark this approved."

Scroll to **Findings**. Three, all blocked, each tagged with its owner:

> "Every finding says who found it. These three are all `code`. The model contributed two
> claims and zero decisions."

Point at the highlighted spans:

> "Those highlights are literal slices of the email, checked character for character. If the
> model paraphrased, the span wouldn't exist."

### 0:40 — The authority table

> "This table is not documentation. It's the same exported object the gate reads before every
> side effect. There is no `approve` outcome in the evaluator — the type only has `reject` and
> `escalate`."

Press **Try to approve as the model**.

> `403 authority_violation — decide.approveChange is owned by "human"`.
>
> "The model can't approve. Not because we asked it not to — because there's no code path."

### 0:55 — The legitimate case

Back to the list. Open **Bank merger**.

> "Same vendor, real change, number on file. No findings."

Press **Approve as clerk**.

> `Requires 2 distinct human approvers; have 1.`

Press **Approve as controller**.

> "Approved. Two different people, after a 48-hour cooling-off period that runs as a Durable
> Object alarm, so it survives a restart."

### 1:10 — Look at the reviewer, not the agent

Open the **Claims** card, press **View evidence** on the IBAN, then approve.

> "The approval records what the human did: two citations opened, nine seconds. That's the part
> everyone skips — the model is measured to death and the person signing off is measured not at
> all."

### 1:25 — Replay

Press **Replay decision**.

> "It re-runs the evaluation with the clock recorded at intake. Identical decision. If it ever
> differs, that's a bug, not a second opinion."

Press **Re-extract and diff** to show the claim diff.

### 1:30 — The close

> "Thirty cases: ten legitimate, eleven fraud, nine hard negatives. Zero fraud cases reach an
> approvable state. Zero auto-approvals. And on a real model the safety numbers don't move when
> the model changes — only how many clean requests get through."

## Deeper beats (if asked)

**"What if the model goes rogue?"**

```sh
npx wrangler dev --var EXTRACTION_MODE:compromised-schema
```

> "It returns claims plus `decision: approve`. The schema rejects the entire response — we don't
> salvage the claims from a response that tried to decide."

```sh
npx wrangler dev --var EXTRACTION_MODE:compromised-fabricated
```

> "This one invents a callback number. Anchoring drops it, because the quote isn't in the email.
> The fabricated number never reaches the evaluator."

**"What about the cooling-off alarm surviving a crash?"**

```sh
pnpm test:do
```

> "Real workerd, alarm fires, process killed, restarted against the same storage, state
> rehydrates. Seven checks, no mocks."

## Questions you will get

**"Isn't this just a prompt?"**
No. The evaluator's return type has two variants, neither of which is `approve`. Approval is a
separate function that throws if a non-human actor appears in the list.

**"What happens when a better model ships?"**
Nothing about the authority changes. Better extraction means more legitimate requests clear
human review; it cannot make a fraudulent one approvable.

**"Why not block all bank-detail changes?"**
Because suppliers change banks. The product is not "no"; it's "not without a verifiable file".

**"How do you know it works?"**
30 cases, 0 fraud escapes, 0 auto-approvals, 100% citation validity. The failure modes are
enumerated in `DESIGN.md` §9 and each has a test.

## What not to claim

- Don't say it prevents fraud. It prevents a fraudulent **change request** from being approved.
- Don't quote the eval numbers as evidence about the real world. The cases are synthetic.
- Don't say the model can't be fooled. Say it can be fooled and it doesn't matter.
