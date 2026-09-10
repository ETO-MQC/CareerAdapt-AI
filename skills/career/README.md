# CareerAdapt portable skills

This folder contains six portable, evidence-first career skills. Each
`SKILL.md` follows Hermes portable-skill metadata and section conventions, but
the documents remain workflow guidance: they do not depend on CareerAdapt's
`AgentKernel`, browser state, or a vendor SDK.

Each skill preserves these boundaries:

- Treat candidate statements, imported documents, and profile facts as separate evidence sources.
- Never invent a fact, metric, employer, title, date, tool, or outcome.
- Keep job-specific tailoring separate from the general profile.
- Mark uncertainty and ask for confirmation before a new fact appears in a resume, preview, or export.
- Return structured work products plus source references, not only prose.

P4.8a adds one shared maturity vocabulary across the six skills:
`demonstrated` (已证明经历), `confirmed_capability` (用户确认能力),
`familiar` (熟悉 / 基础接触), and `learning` (学习中 / 目标能力). A user
confirmation is valid evidence for a capability even when no project
provenance exists, but it must not be narrated as demonstrated experience.
Every resume-facing claim keeps its maturity and bounded language.

Resume work uses three explicit modes: `steady` / 稳健 uses demonstrated
evidence only; `competitive` / 竞争力 is the default and may combine
demonstrated evidence, confirmed capability, and clearly transferable work;
`max_fit` / 最大匹配 may surface gaps and ask bounded questions, but never
invents a hard fact. A confirmed tailoring claim defaults to the current
resume branch; syncing it to Profile is always a separate explicit choice.

The skills are reference-grounded but not a training or fine-tuning pipeline:
future external corpus guidance may affect style or questions only, never
candidate facts, branches, revisions, or exports.

## Skills

1. `candidate-profile-interview` — ask the smallest useful next question and capture the answer against the active career asset.
2. `career-story-mining` — turn raw experience narration into evidence-backed story components.
3. `job-fit-analysis` — compare a job description with confirmed profile evidence and expose matches and gaps.
4. `resume-tailoring` — propose job-specific resume changes without changing the source profile.
5. `resume-review` — review a resume for factual support, clarity, relevance, and unsupported claims.
6. `resume-composition` — assemble a target-aware, evidence-backed resume blueprint and writing proposal before revision creation.

The host application owns persistence, confirmation, revision checks, and
export. These skills describe reasoning and structured outputs only. The
Hermes runtime must call the host's `career.*` gateway; it must not write local
storage directly.
