# Handoff: the second domain harness

_For a new session. English body, Japanese summary at the end._

## Goal

A second domain harness, built the same way as `payment-change-control`, but in a domain where
the expensive mistake is **not** a payment redirect. The point is to prove the shape generalises,
not to repeat it.

The shape to reuse:

- an authority table with one owner per decision
- an evaluator whose return type cannot express `approve`
- citations validated by code, not trusted from the model
- a durable per-request session with a timer
- adversarial evals, not just curated ones

## What "different" should mean

Changing industry but keeping the same mechanism (amounts, limits, approvals) produces a
reskin. Pick a domain where the **deterministic core is temporal or structural**, so the code
that decides is genuinely different:

| Harness                  | Deterministic core                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `payment-change-control` | money + identity (amounts, checksums, domain match)                                           |
| candidate #2             | **time** (windows, deadlines, notice periods) or **structure** (clauses, criteria, schedules) |

## Shortlist

Market research for late 2026 puts the strongest vertical agent traction in legal, healthcare,
insurance, finance ops, real estate, construction, and accounting. Crowding is fine for a
portfolio piece and bad for a company — decide which this is first.

| Domain                                | Deterministic core                                                                      | Model's job                                                    | Demo moment                                                                       | Data                                  | Trap                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| **Insurance claim triage (FNOL)**     | policy version, effective dates, limits, exclusions, statutory acknowledgment deadlines | read the narrative and documents, extract facts with citations | "filed 3 days after the policy lapsed" or "flood is excluded in this endorsement" | synthetic policies + claim narratives | real policy language is jurisdiction-specific; synthetic policies come out too clean |
| **Grant / benefit eligibility**       | income thresholds, residency, document checklist, appeal windows                        | extract facts from applications, map to criteria               | "eligible, but one mandatory document is missing"                                 | published programme rules             | rules are local and change yearly                                                    |
| **Contract renewal triage**           | notice periods, auto-renewal dates, caps, termination rights                            | extract clauses from the contract                              | "auto-renews in 14 days at 3× the current price"                                  | synthetic contracts                   | too close to harness #1                                                              |
| **Clinical trial eligibility**        | inclusion/exclusion criteria, washout windows                                           | parse clinical notes, match criteria                           | "meets 9 of 10, fails the renal threshold"                                        | synthetic patient records             | regulated; wrong answers are harmful, which changes the stakes and the writing       |
| **Customs / tariff classification**   | HS codes, duty rates, rules of origin, anti-dumping flags                               | classify goods from descriptions                               | "classification saves 4.7% but triggers an anti-dumping check"                    | public tariff schedules               | correctness is hard to fake credibly                                                 |
| **Public procurement bid compliance** | mandatory criteria checklist, submission deadlines                                      | map bid documents to criteria                                  | "non-compliant on one mandatory item"                                             | public tender documents               | documents are long and messy; ingestion dominates                                    |

## Recommendation

**Insurance claim triage (FNOL).**

Reasons:

1. **The core is temporal.** Coverage is a function of the policy version in force on the loss
   date, the notification window, and the limits at that time. That is a different kind of code
   from harness #1, so the exercise teaches something.
2. **The demo is visceral.** "This claim was filed after the policy lapsed, and the system
   refuses to route it for payment" needs no explanation.
3. **The human decision is already a named role** (adjuster), so the approval gate maps onto an
   existing workflow instead of inventing one.
4. **Synthetic data is credible.** Policy schedules are structured; claim narratives are prose.
   You can build 30 cases without a customer.

Second choice: **grant eligibility**, if you want public rules rather than invented ones. It is
the more defensible choice for a company and the duller one for a demo.

## What to reuse unchanged

- `packages/domain` structure: pure, no I/O, one file per concern
- the authority table and the gate that throws
- the typed evaluator with no `approve` variant
- citation anchoring and `isWellFormedValue`
- the Durable Object per request with an event log and alarms
- the adversarial mutation generator
- the durability script

## What must change

| Concern           | Change                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Deadlines         | statutory windows are not a fixed 48h; each has its own clock and legal consequence     |
| Documents         | claims arrive as PDFs and photos; extraction must handle layout, not just prose         |
| Policy versioning | the policy in force at the loss date, not at intake                                     |
| Jurisdiction      | exclusions and deadlines are jurisdiction-specific; make it a parameter, not a constant |
| Money             | claim amounts are ranges and estimates, not exact transfers                             |

## First tickets

1. **Policy schedule + coverage engine.** Pure functions: `inForce(policy, lossDate)`,
   `covered(peril, exclusions)`, `withinNotificationWindow(lossDate, filedAt, jurisdiction)`.
   Tests only, no model.
2. **Claim intake with deadlines.** One Durable Object per claim, one alarm per statutory window.
3. **Narrative extraction.** Claims + citations, same schema discipline as harness #1.
4. **The refusal path.** A claim that fails coverage must produce a letter-shaped explanation with
   citations, not a status code.
5. **Adversarial corpus.** Mutate dates, perils, amounts, and policy versions one at a time.
6. **Adjuster review packet.** Same UI shape as harness #1, different vocabulary.

## Honest warning

This is the same project with a different domain. It will look like a template applied twice, and
a sharp reviewer will say so. Two ways to avoid that:

- **Change the mechanism**, not just the nouns: make time the core, as recommended.
- **Write the comparison.** A short doc on what transferred and what didn't is more valuable than
  the second implementation.

If the goal is a company rather than a portfolio, skip this and go talk to 15 adjusters instead.
The research is unambiguous that the moat is domain access, not another harness.

---

## 日本語サマリ

**目的:** 1つ目（振込先変更）と同じ形のハーネスを、**お金ではなく時間**が決定論的な核になる
領域でもう一度作る。形が一般化することを示すのが目的で、焼き直しではない。

**推奨ドメイン:** 保険金請求の受付トリアージ（FNOL）。

- 決定論的な核: 保険証券のバージョン、損失発生日に有効だったか、通知期限、免責・支払限度
- モデルの仕事: 請求書類と文章から事実を抽出し、引用を付ける
- デモ: 「保険が切れた3日後に請求されている」「この特約では洪水は免責」
- 代替案: 給付・助成の Eligibility（公開ルールを使えるがデモは地味）

**再利用するもの:** 権限表とゲート、`approve` を持たない評価型、引用のアンカー、Durable
Object、敵対的テスト、耐久性テスト。

**変えるもの:** 期限は48時間固定ではなく法令ごとに異なる／書類はPDFと画像／証券は「受付時」
ではなく「損失発生日」のバージョン／免責は法域依存／金額は確定値ではない。

**正直な注意:** 同じ設計を別ドメインに適用しただけに見える。避けるには「仕組みを変える」
（時間を核にする）か、「何が transfer して何がしなかったかを書く」。
会社を作る目的なら、これはやらずに調整担当者15人に会うほうが価値がある。
