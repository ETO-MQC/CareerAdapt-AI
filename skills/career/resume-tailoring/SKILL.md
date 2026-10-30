---
name: resume-tailoring
description: Create or tailor a job-specific Resume when the user supplies or selects a target Job or JD, while keeping claims evidence-bound.
version: 2.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [tailoring, job-branch, diff, fact-safety]
    related_skills: [job-fit-analysis, resume-review]
---

# Resume tailoring

## WHEN TO USE

Use when the user supplies or selects a target Job or JD and asks for a
job-specific Resume to be created or tailored. A pasted JD may go directly to
this workflow; a prior Job Fit result is optional unless the user requested
Job Fit separately. Keep the general Resume and Profile isolated while
proposing target-specific changes.

Do not use for a general/base Resume, Job Fit-only comparison, importing a
resume, or reviewing a Resume without a target Job/JD.

## INPUTS

- Target Job/JD or supplied target text, with stable requirement IDs when they
  are already available.
- Selected source resume or general profile branch and revision.
- Confirmed evidence graph/blueprint, source quotes, and user-approved
  preferences.
- Fixed person/profile/session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the confirmed Profile, source Resume, and target Job/JD before planning
any question or rewrite. Incorporate an existing fit analysis when available;
do not require a prior Job Fit call for a pasted or newly supplied target.

### WHEN TO ASK

Ask only when the answer can change match status, evidence selection,
tailoring strategy, or fact safety.

### WHAT NOT TO ASK

Do not ask for optional metadata, repeat known facts, or block tailoring on a
missing detail that can be handled as a visible conservative gap.

### QUESTION BUDGET

Ordinary tailoring asks 0–1 high-value questions; `steady` may use zero.
`competitive` asks at most two and `max_fit` at most three, one at a time.
The host may freeze a smaller budget; never reopen or exceed that plan.
If the user says “先别问了，直接生成”, stop optional questions and draft safely.

### WHEN TO PROCEED

Continue conservatively when the user is unsure, preserve the unsupported
requirement as unknown, and wait only at the review or confirmation boundary.

### STOP CONDITION

Stop before applying or exporting when evidence, revision, or explicit
confirmation is missing.

### RECOVERY

Re-read stale inputs and regenerate only the affected proposal; never replay a
write or silently change the source branch.

Every proposal retains its checkpoint, source branch fingerprint, and base
revision. A stale source, job, or Profile creates a new proposal; it never
replays an old write.

## TAILORING MODES

Use one explicit mode for every new tailoring plan:

- `steady` / 稳健: demonstrated experience only; do not ask gap questions.
- `competitive` / 竞争力: the default; combine demonstrated experience,
  user-confirmed capability, and clearly transferable evidence while keeping
  maturity-bound wording.
- `max_fit` / 最大匹配: surface important JD gaps and ask no more than three
  bounded questions. For a missing capability, offer these optional factual
  choices: `实际做过`, `能够独立完成基础任务`, `接触 / 学习过`,
  `没有使用过`, `不确定`, or `跳过`. The answer is not itself resume copy;
  translate it into a bounded claim and keep it pending confirmation.

Hard fact findings remain blocked in every mode. Familiar or learning answers
may explain a gap or produce bounded, reviewable language, but never prove a
completed project or ownership outcome.

## GAP SCORECARD

Before drafting, map each important requirement to one explicit state:

- `covered`: confirmed evidence already supports the requirement;
- `rewriteable`: existing evidence can be reordered or expressed more clearly;
- `confirmable`: a user answer may add a branch-scoped claim;
- `material_only`: keep it as a preparation task or evidence request;
- `uncovered`: show the gap and do not stuff the keyword.

Each row keeps requirement IDs, evidence refs, candidate items, missing
keywords, and clarification IDs. Ask no more than three high-value questions;
do not block a safe resume-only draft on optional detail.

## WORKFLOW

1. Read the composition evidence graph/blueprint or build the bounded
   job-specific context, then produce the gap scorecard before prioritizing
   evidence that is relevant, specific, and supported by the fit matrix.
2. Propose a reversible diff with section, source IDs/quotes, old value,
   proposed value, rationale, and confidence.
3. Prefer truthful emphasis, ordering, and concise wording before new content.
4. Run a separate global review pass. Separate evidence eligibility from final
   exact-keyword presence, retain unsupported requirements as visible gaps, and
   perform at most one safe ATS repair for an exact supported concept. Run
   Fact Guard and the reviewer again before approval.
5. Wait for explicit approval before applying or exporting. A confirmed claim
   defaults to `resume_only`; `resume_and_profile` is a separate explicit
   choice that creates a confirmed Profile fact, records `user_input`
   provenance, and increments the Profile revision.

## TOOL BOUNDARIES

Use only the high-level facade
`mcp__careeradapt__career_workflow_tailor_resume` through the host gateway.
It owns target selection, proposal/review checkpoints, and the confirmation
boundary. Proposal generation is not a write; applying a target-specific
change requires host confirmation and revision checks. Never call atomic
tailoring or preview tools and never write the repository from Skill code.

## FACT SAFETY

Never invent achievements, metrics, titles, dates, or skills. A job
requirement cannot become a resume claim. Preserve unsupported requirements as
gaps or questions and keep provenance attached to each proposed line.

## STOP CONDITIONS

Stop when the source branch, job requirement, evidence, or revision is missing;
when review finds an unsupported claim; or when confirmation is not present.
Do not export a pending diff.

## RECOVERY

For stale revisions, reread the branch and regenerate only the affected diff;
never replay an apply write automatically. For a missing job/profile, refresh
discovery and ask for selection. For provider/MCP transient failure, preserve
the proposal/checkpoint and retry planning, not the write. A source branch
change aborts the apply transaction.

## OUTPUT

Core-02 contract: retain the selected Job version's requirement IDs and the
version-bound `candidateEvidenceMatrix.analysisId`. Use only relevant evidence
rows for each field. Preserve unsupported requirements as `withheld` with a
reason; never translate an unknown capability into a negative personal fact.
Do not request the JD again when the session already binds its saved version.

Return a requirement-to-evidence map and gap scorecard, reversible diff items,
provenance, unsupported-claim warnings, evidence-eligibility versus final ATS
coverage, confidence, review findings, and a confirmation checklist. State
clearly whether the result is proposal-only or approved.

## CLAIM SAFETY v2

Profile absence means unknown, never inability. Decompose important additions
into atomic claims, retaining source turn/quote and requirement IDs where relevant.
Use these analysis labels with the existing host contracts, not a second fact model:

- `source_confirmed`: confirmed Profile/attachment evidence; usable at its stated maturity.
- `user_confirmed`: an explicit current user answer is legitimate evidence even
  without a project or uploaded proof. Keep the exact answer, source turn,
  session/target/revision binding and the normal proposal confirmation boundary.
- `transferable`: adjacent experience supports a related capability, not the
  target tool itself (R/Stata/Excel data cleaning does not prove Python).
- `exploratory`: plausible but unknown; ask, give examples, help recall; never emit.
- `learning` / `familiar`: write only the confirmed basic knowledge, coursework,
  exposure or learning level; never infer proficiency, a project or delivery.
- `high_risk_unsupported`: invented education, employer, role, dates, credentials,
  awards, metrics, team size, ownership or business results; block and explain.

Fact Guard asks whether wording exceeds what the user supplied or confirmed,
not whether the same words already exist in Profile. Natural supported synonyms
and job keywords are allowed. JD text and offered examples are never evidence.
A negative answer can establish a real gap; uncertainty/skip cannot.
New confirmed claims default to `resume_only`. Only explicit
`resume_and_profile` authorizes a separate reviewed Profile write. Reuse host
source-turn/declaration/maturity contracts; a Skill label alone grants no write
or guard bypass. Keep Repository, CAS, target/revision and confirmation checks.

## GUIDED CLARIFICATION AND WRITING

Analyze before asking. Reuse JobRequirementGraph and CandidateEvidenceMatrix;
never parse a saved JD again. Rank unanswered important requirements as
`high / medium / low value to clarify`, explaining importance, evidence
certainty, likely resume impact, answerability and duplication. Do not invent
probabilities. Ask only the highest-value unresolved question within the frozen
budget; do not repeat answered/skipped facts or turn the task into a questionnaire.

Help answer: “这个岗位很看重 Python 数据处理。资料里没写不代表你没用过。
你更接近哪种：项目/比赛用过、课程练习能做基础任务、学过 Pandas/NumPy、
简单接触、没用过？也可以自由回答。” Examples are prompts, not claims.
On a vague ownership correction, ask which part: design, execution or delivery.

Optimize in order: select relevant existing experience; prioritize sections and
bullets; re-express supported experience in JD language; add confirmed current
answers; align supported ATS terms; remove low-value content. Never stuff a
missing keyword. Each important addition exposes requirementId → evidence or
question → exact user answer/source turn → claim state/maturity → resume diff.
Confirm factual accuracy and scope separately from approval to apply the proposal.
