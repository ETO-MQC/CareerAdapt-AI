---
name: candidate-profile-interview
description: Create or complete a CareerProfile from user-provided experience, or answer an active Profile Intake question with evidence-bound facts.
version: 2.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [profile, interview, evidence, fact-safety]
    related_skills: [career-story-mining, resume-review]
---

# Candidate profile interview

## WHEN TO USE

Use when the user wants to create or complete their CareerProfile from scratch,
or when they are answering an active Profile Intake question. Keep each answer
attached to the selected asset and current Agent Session.

Do not use for extracting one story without a Profile update, comparing a
candidate with a Job/JD, creating a general Resume, tailoring a target Resume,
or reviewing an existing Resume.

## INPUTS

- Active `personId`, `profileId`, profile revision, and `agentSessionId`.
- An optional active question with its dimension and question revision.
- Confirmed structured facts, source quotes, and answered/skipped ledger.
- The candidate's latest turn.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the current Person/Profile version, confirmed assets, source turns, and
the answered/skipped ledger before interpreting the latest turn.

### WHEN TO ASK

Ask one question only when the answer is not already evidenced, changes the
quality or safety of the next career asset, and is the highest-value unresolved
gap. Use a budget of two high-value follow-ups per substantial asset; a good
asset may use zero.

### WHAT NOT TO ASK

Do not ask for an empty schema field, repeat an answered or skipped question,
or force project-style detail on education, awards, or already-ready assets.

### WHEN TO PROCEED

Proceed with a conservative draft when the candidate does not know, and keep
the missing dimension visible instead of inventing a fact.

### STOP CONDITION

Stop at one question, a true conflict, an explicit user correction, or a
review/confirmation boundary.

### RECOVERY

Re-read stale state, preserve the source quote, and re-plan without replaying
a write. Never turn a recovery step into a new factual assertion.

## WORKFLOW

1. Resolve the turn against the active question before generic intent rules.
2. Classify answer, correction, skip, reference, workflow control, new asset,
   or casual conversation.
3. Identify multiple career assets in a natural turn, retaining the exact source
   quote and turn ID for each. During an active targeted follow-up, patch only
   its bound asset; unrelated assets remain separate proposals.
4. Record a skip so the same question is not asked again.
5. Ask at most one highest-value next question and leave gaps visible.

### FACT MATURITY AND COMMIT REVIEW

Label each confirmed result as demonstrated experience, user-confirmed
capability, familiar/basic exposure, or learning/aspirational. Confirmation is
valid evidence without project provenance, but the latter two levels must stay
bounded and must not be promoted into experience claims. When an experience
has enough source support, prepare three to four exact reusable fact bullets
with source quotes; do not paraphrase them into new facts. Before the Profile
commit boundary, show a compact factual review of those bullets, ownership,
dates, and unresolved dimensions. The review is a confirmation surface, not a
silent write.

## TOOL BOUNDARIES

Use `mcp__careeradapt__career_workflow_profile_intake_turn` to capture or
continue the user turn. When all intake source turns are ready and the user
asks to finalize, use
`mcp__careeradapt__career_workflow_profile_intake_finalize`. These facades own
the provisional state, review boundary, and guarded Profile commit; never call
atomic Profile tools or write `WorkspaceRepository` directly.

## FACT SAFETY

Never infer a metric, title, date, employer, tool, ownership boundary, or
outcome. New claims remain pending confirmation and cannot enter preview or
export until the host validates their evidence.

## STOP CONDITIONS

Stop and ask for clarification when the target asset or question revision is
missing, the answer supports multiple assets, or the candidate disputes the
source. Stop before synthesis when evidence is ambiguous.

## RECOVERY

For a stale revision, reread the active asset and rebase the proposal without
repeating a write. For a missing asset, refresh discovery and ask the host to
select one. For validation or provider failure, preserve the quote and ledger
state and return a concise retry instruction.

## OUTPUT

Return a structured resolution with `kind`, question identifiers, confidence,
reason, source-bound patch or skip entry, unresolved fields, and one next-turn
plan. Include no unconfirmed resume-ready prose.

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

## NATURAL INTAKE v2

Collect useful career assets, not every empty schema field. One turn can contain
several facts. Ask only the most valuable missing dimension; do not force a
capability into a fabricated Project achievement. A statement such as “SQL 基础
查询我能独立完成” can support a bounded capability without a project source.
Preserve session binding, Profile revision, source turns and final confirmation.
