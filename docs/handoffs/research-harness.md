# Handoff: the research-and-implement harness

_For a new session. English body, Japanese summary at the end._

## What this is

An agent that takes a vague idea, researches it, decides whether it is worth building, writes a
spec, and then builds it — with a human approving the **plan** once, and nothing after that.

It is not a coding agent. Coding is the last 30% of it. The part that doesn't exist yet is the
front half: turning "I want to build something with Durable Objects" into a validated problem
with evidence, and then into a spec worth implementing.

## Why this gap is real

Every agent workflow in circulation starts _after_ the goal is known:

- `grilling` interrogates a decision you already have.
- `to-spec` turns a conversation into a spec.
- `to-tickets` turns a spec into slices.
- `implement` / `review` / `pr` execute.

The chain assumes a human did the research and chose the problem. In practice that is where the
time goes and where the expensive mistakes happen — you can execute a bad choice perfectly.

The DeepSeek prototype (`dsh-superagent`) is the closest published thing: a proactive coding
agent for one repository that opens work items and answers in the original conversation. Its
stated principle is _"take as little human attention as possible, and give as much value as
possible."_ But it starts from an ask, not from an investigation.

## Prior art worth reading

| Work                                   | What it contributes                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepseek-ai/dsh-superagent-prototype` | Work-item lifecycle, authorization model, "speak only when a human must act", operator docs 000–008                                                         |
| **Harness²** (Google, Oct 2026)        | Improves the harness — prompts, tools, memory, skills — while weights stay frozen; +11.5 pts on WorkBuddy-Bench in one step                                 |
| **Self-Harness**                       | Mines execution traces for model-specific failures, then proposes harness edits; propose → evaluate → accept                                                |
| **HyperAgents** (Meta)                 | A meta-agent that edits the task agent; self-referential by construction                                                                                    |
| **"Why LLMs Aren't Scientists Yet"**   | Six failure modes: training-data defaults, implementation drift, memory degradation, over-optimism, insufficient domain intelligence, weak scientific taste |
| `pstack` / Matt Pocock skill chains    | The execution half, already solid                                                                                                                           |

The failure-mode paper is the most useful of these. Read it before designing the loop, because
every one of the six will happen.

## Proposed shape

```
vague prompt
   │
   ▼
[1] INTAKE        restate the idea, name the unknowns, list what would falsify it
   │
   ▼
[2] RESEARCH      web + docs + prior art → evidence pack (every claim cited)
   │
   ▼
[3] GRILL         adversarial questioning of the evidence, not the idea
   │
   ▼
[4] DECIDE        build / narrow / kill — with the reasoning recorded
   │
   ▼
   ★ CHECKPOINT   human approves the plan once
   │
   ▼
[5] SPEC          acceptance criteria, non-goals, authority table
   │
   ▼
[6] TICKETS       vertical slices with blocking edges
   │
   ▼
[7] BUILD LOOP    implement → review → verify → PR → merge
   │
   ▼
[8] RETRO         diff the traces; propose one harness change
```

Stage 8 is what makes it a harness rather than a workflow. Self-Harness's contribution is that
the improvement should be driven by **failure traces**, not by vibes — so the retro must read
the logs of what actually went wrong.

## The hard parts

**Deciding when to stop researching.** Without a budget, stage 2 runs forever. The budget should
be measured in _questions answered_, not tokens: "can I state the three biggest risks and the
evidence for each?"

**Killing ideas.** The system needs permission to output "don't build this" without the human
feeling it wasted the run. A killed idea with a written reason is a successful outcome.

**Implementation drift.** The spec says one thing, the code does another, and both look
plausible. Mitigation: acceptance criteria must be executable assertions, not prose.

**Over-optimism.** Agents declare success on noise. Mitigation: the verifier cannot be the
implementer, and the metric is fixed before the work starts.

**Context degradation across a long run.** Mitigation: the evidence pack and decision log live
in files, not in the context window; each stage starts from the files.

## Human boundary

One approval, at stage 4. The checkpoint shows:

- the problem statement in one paragraph
- the three biggest risks, with evidence
- what the agent would build, and what it would explicitly not build
- the estimated cost in sessions

After approval, the human is not asked anything until a PR is ready to merge — and even that is
self-merged if CI is green, unless the repo policy says otherwise.

## What to measure

If this is going to be more than a toy, it needs numbers:

| Metric               | Why                                                              |
| -------------------- | ---------------------------------------------------------------- |
| Spec acceptance rate | Did the human approve stage 4 unchanged?                         |
| Rework rate          | Fraction of merged PRs that needed a follow-up fix within a week |
| Evidence density     | Cited claims per decision in the research pack                   |
| Cost per merged PR   | Sessions + tokens                                                |
| Kill rate            | How often the correct output was "don't build"                   |

A harness that approves everything has a spec acceptance rate of 100% and is worthless.

## First tickets

1. **Evidence pack format.** A file per project: claims, citations, confidence, and an explicit
   "what would change my mind". No UI.
2. **Stage 1–2 loop with a research budget.** Answers N questions, then stops and writes the pack.
3. **The grill step, applied to evidence.** Reuse `grilling`, but the subject is the pack's claims.
4. **Decision record.** A one-page ADR per project: build / narrow / kill, with reasons.
5. **Trace capture.** Every stage writes a JSON trace; stage 8 reads them.
6. **Retro proposer.** One harness change per completed project, with the trace that motivated it.
7. **The build loop.** Reuse the existing skill chain; do not reinvent it.

## Open questions

- Where does this run? A local CLI is enough for personal use; a team version needs the
  authorization model from `dsh-superagent`.
- Does the evidence pack belong in the repo or beside it? In-repo makes it reviewable; beside it
  keeps the product clean.
- How do you evaluate a harness whose output is a decision, not code? Perhaps by replaying past
  decisions and checking whether the research would have changed them.

---

## 日本語サマリ

**目的:** 曖昧なアイデアから、調査・意思決定・仕様化・実装までを一気通貫で行うエージェント。
人間の介入は**計画承認の1回だけ**。

**なぜ必要か:** 既存のスキル連鎖（grilling → to-spec → to-tickets → implement）は、すでに
目的が決まっている前提で動く。時間がかかり、失敗コストが高いのはその前段——何を作るかの
調査と選択——であり、そこが空いている。

**構成:** intake → research（出典付きの証拠パック）→ grill → decide → ★人間の承認 →
spec → tickets → build loop → retro（トレースから harness を1つ改善）。

**難しい点:** 調査の終了条件（質問数で予算化）、殺す勇気、実装ドリフト、楽観的な自己評価、
長い実行での文脈劣化。対策は「証拠と決定をファイルに置く」「検証者は実装者ではない」
「受け入れ条件は実行可能な assertion にする」。

**先行例:** DeepSeek `dsh-superagent`（作業項目・権限・「人間が動くときだけ話す」）、
Harness²（重みを固定したまま harness を改善）、Self-Harness（実行トレースから弱点を掘る）、
HyperAgents（メタエージェントが作業エージェントを編集）、「Why LLMs Aren't Scientists Yet」
（6つの失敗モード）。
