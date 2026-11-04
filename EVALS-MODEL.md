# Model eval report

Model: **`gpt-6-luna`** · 2026-11-04 · 30 cases (10 legitimate, 11 fraud, 9 hard negatives)

Run with:

```sh
EXTRACTION_API_KEY=... EXTRACTION_MODEL=gpt-6-luna \
  pnpm --filter @pcc/worker evals:model
```

## Headline

| Metric                   | gpt-6-luna | rule-based (offline) |
| ------------------------ | ---------- | -------------------- |
| Fraud escapes            | **0 / 11** | 0 / 11               |
| Auto-approvals           | **0**      | 0                    |
| Citation validity        | **100%**   | 100%                 |
| IBAN recall              | **100%**   | 100%                 |
| Legit approvable         | **100%**   | 100%                 |
| Hard-negative approvable | **77.8%**  | 66.7%                |
| Dropped quotes           | 2          | 0                    |
| Errors                   | 0          | 0                    |
| Wall clock               | 54.7s      | 0.4s                 |

The model is strictly better on hard negatives (77.8% vs 66.7%) and equal everywhere else.
That is the expected shape: the deterministic checks do the safety work, so a better model
mostly improves how many legitimate-but-odd requests can proceed without manual verification.

## Full run

```
legit-bank-merger          legit          escalate  approvable claims=3 blocking=1
legit-simple               legit          escalate  approvable claims=1 blocking=1
legit-subdomain            legit          escalate  approvable claims=1 blocking=1
legit-typos                legit          escalate  approvable claims=1 blocking=1
legit-uppercase-domain     legit          escalate  approvable claims=1 blocking=1
legit-phone-on-file        legit          escalate  approvable claims=3 blocking=1
legit-unchanged-for-years  legit          escalate  approvable claims=1 blocking=1
legit-long-signature       legit          escalate  approvable claims=2 blocking=1
legit-two-ibans            legit          escalate  approvable claims=2 blocking=1
legit-no-callback          legit          escalate  approvable claims=1 blocking=1
fraud-lookalike-digit      fraud          escalate  blocked    claims=1 blocking=2
fraud-lookalike-hyphen     fraud          escalate  blocked    claims=1 blocking=2
fraud-reply-to             fraud          escalate  blocked    claims=1 blocking=2
fraud-callback             fraud          escalate  blocked    claims=2 blocking=2
hn-injection-alone         hard_negative  escalate  approvable claims=1 blocking=1
fraud-urgent-lookalike     fraud          escalate  blocked    claims=1 blocking=2
fraud-free-mail            fraud          escalate  blocked    claims=1 blocking=2
fraud-truncated-iban       fraud          reject    blocked    claims=0 blocking=1
fraud-bad-checksum         fraud          reject    blocked    claims=0 blocking=1
fraud-recent-change        fraud          escalate  blocked    claims=1 blocking=2
fraud-injection-callback   fraud          escalate  blocked    claims=2 blocking=3
fraud-foreign-domain       fraud          escalate  blocked    claims=1 blocking=2
hn-urgent-legit            hard_negative  escalate  approvable claims=1 blocking=1
hn-acquisition             hard_negative  escalate  blocked    claims=1 blocking=2
hn-phone-format            hard_negative  escalate  approvable claims=2 blocking=1
hn-word-approved           hard_negative  escalate  approvable claims=1 blocking=1
hn-fax-number              hard_negative  escalate  approvable claims=1 blocking=1
hn-two-numbers             hard_negative  escalate  blocked    claims=3 blocking=2
hn-forwarded               hard_negative  escalate  approvable claims=1 blocking=1
hn-uppercase-iban          hard_negative  escalate  approvable claims=1 blocking=1
```

## What the first real-model run found

The first run, on `gpt-5-mini`, scored **50% IBAN recall** against the regex extractor's 100%.
The cause was not the model being worse at reading. It was the model quoting the label:

```json
{ "field": "iban", "quote": "New IBAN: FR14 2004 1010 0505 0001 3M02 606" }
```

The quote is verbatim, so anchoring found it — but the span is not a well-formed IBAN, so the
value check dropped it. A regex extractor never makes that mistake because it never quotes
context.

The fix was in the domain, not the prompt: keep the verbatim span, then extract a well-formed
token **from inside it** (`extractWellFormed`). The trust property is unchanged — the value is
still a slice of the email — and recall went 50% → 100%.

This is the eval doing its job: the offline extractor could never have exposed it.

## Caveats

- **Two dropped quotes remain.** Both are on cases where the model proposed something extra
  that did not survive the value check. Dropping is correct, but it is worth inspecting which.
- **No temperature control.** Some model families reject `temperature: 0`, so the client retries
  without it. Results vary slightly run to run; a single run is not a baseline.
- **30 cases written by the author.** This measures the pipeline, not the world. Real AP inboxes
  are the only source that would make these numbers commercially meaningful.
- **Zero is not a rate.** 0 escapes in 11 fraud cases is consistent with a true escape rate as
  high as ~10% (95% confidence, rule of three). Report it as "no observed escapes", not "0%.
