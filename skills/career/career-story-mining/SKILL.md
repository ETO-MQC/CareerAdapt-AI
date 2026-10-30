---
name: career-story-mining
description: Extract actions, methods, challenges, results, and evidence from one user-described career experience without changing Profile or Resume data.
version: 2.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [stories, evidence, provenance, fact-safety]
    related_skills: [candidate-profile-interview, resume-tailoring]
---

# Career story mining

## WHEN TO USE

Use when the user is describing one experience, project, role, or achievement
and wants help extracting its actions, methods, challenges, results, or
evidence. Return a reviewable, source-bound story proposal.

Do not use for creating or completing a CareerProfile, comparing a candidate
with a Job/JD, creating a general Resume, tailoring a target Resume, or
reviewing an existing Resume.

## INPUTS

- Exact narration and source metadata, including source turn or attachment.
- One existing career asset when the turn is a follow-up.
- Optional job context marked as job-specific, never as profile truth.
- Fixed `personId`, `profileId`, profile revision, and Agent Session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the complete current turn, existing assets, source evidence, and prior
answers before splitting or enriching anything.

### WHEN TO ASK

Ask one natural clarification only when asset identity, ownership, or an
outcome-changing detail cannot be safely resolved from the source.

### WHAT NOT TO ASK

Do not ask the user to name schema fields, enumerate every canonical slot, or
repeat facts already present in the source or Profile.

### QUESTION BUDGET

Use at most one question per turn and prefer broad acknowledgement before
selecting one high-value asset gap from a multi-asset narrative.

### WHEN TO PROCEED

Proceed with separated, evidence-bound candidates when the source is clear;
leave optional enrichment as an explicit gap.

### STOP CONDITION

Stop when identity, ownership, or asset separation would require an
unsupported inference.

### RECOVERY

Preserve the original turn, refresh the relevant asset, and ask only the
smallest clarification needed to re-anchor the proposal.

## WORKFLOW

1. Extract only context, scope, role, actions, methods, challenge, response,
   result, deliverable, collaboration, and ownership boundaries supported by
   the source.
2. Preserve the exact quote beside every normalized candidate fact.
3. Separate explicit claims from interpretations that need review.
4. Split multiple assets only when the source gives each a clear identity;
   otherwise ask one clarifying question.

## REUSABLE FACT OUTPUT

Attach a maturity label to every candidate fact. Prefer demonstrated facts for
story results; record a user-confirmed capability as capability evidence even
without project provenance; keep familiar and learning statements explicitly
bounded. When evidence supports it, return three to four compact reusable
bullets copied from exact source-grounded statements, with fact/source IDs and
source quotes. These bullets are review material only and cannot be written to
Profile or a Resume until the existing confirmation contract is invoked.

## TOOL BOUNDARIES

Return a proposal for the host to validate. Use
`mcp__careeradapt__career_context_retrieve` only when confirmed saved context is
semantically needed to anchor the story. This skill never writes a Profile,
Resume, or Job branch and never accesses `WorkspaceRepository` directly.

## FACT SAFETY

Do not add metrics, tools, titles, dates, employers, scope, or outcomes absent
from the source. Job requirements and model suggestions are not evidence.
Uncertain facts remain pending confirmation and are excluded from export.

## STOP CONDITIONS

Stop when source provenance is missing, two assets cannot be separated, the
candidate disputes a normalization, or the requested claim exceeds the source.

## RECOVERY

For a stale profile revision, reread and rebase only the proposed patch. For a
missing asset, refresh discovery and request a selection. For malformed input,
return the preserved quote and a targeted clarification; do not retry a write.

## OUTPUT

Return target asset IDs, candidate patches, exact evidence links, confidence,
unresolved fields, and one next-question proposal. Each patch must be scoped
to one asset and must not replace unrelated facts.

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

## STORY MINING v2

Use Context → Task → Action → Method → Challenge → Result → Ownership as an
internal lens, not a STAR form. Ask only the most useful current layer:
1. What happened / what problem? 2. What did you do? 3. How/tools/method?
4. What changed or was delivered? Preserve team versus individual contribution.
If answering is difficult, offer 3–5 context-specific examples, with free text:
“数据清洗更接近缺失值处理、异常值排查、多表合并、格式统一、口径核对哪种？”
Only the user's selection/answer establishes a claim; never save the examples.
A real qualitative deliverable is useful without a metric. Do not chase a number.
