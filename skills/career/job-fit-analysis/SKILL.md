---
name: job-fit-analysis
description: Compare a candidate's confirmed evidence with a selected Job or JD without creating or modifying a Resume.
version: 2.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [job-fit, requirements, gaps, evidence]
    related_skills: [resume-tailoring, resume-review]
---

# Job fit analysis

## WHEN TO USE

Use when the user asks whether their confirmed experience matches a selected
Job or JD, or asks for the material evidence gaps. Keep the result in the
selected job context.

Do not use to create or modify a Resume, tailor a target Resume, import a
document, or answer general career advice. A prior Job Fit call is not a
precondition for Resume Tailoring.

## INPUTS

- Selected Job or JD with stable requirement IDs.
- Confirmed profile facts and career assets with source evidence.
- Optional target resume branch and its revision.
- Fixed Agent Session binding; job identity is separate from person/profile.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the parsed Job, confirmed Profile evidence, selected Resume, and existing
fit analysis before asking the user anything.

### WHEN TO ASK

Normally analyze first. Ask only when one ambiguous candidate fact could
materially change a must-have or high-value requirement result.

### WHAT NOT TO ASK

Do not interrogate every unmatched keyword or ask for facts that are already
in the Profile, Resume, Job, or source turns.

### QUESTION BUDGET

Use zero questions by default and at most one focused clarification in a
normal fit analysis.

### WHEN TO PROCEED

If the user does not know, record the gap and continue conservatively with a
visible evidence status.

### STOP CONDITION

Stop only for an ambiguous requirement identity, a material factual conflict,
or a missing source that makes the comparison unsafe.

### RECOVERY

Re-read the affected Job/Profile revision and recompute only the impacted
requirement rows; do not broaden the question set.

## WORKFLOW

1. Read the saved JobRequirementGraph and its source/version binding; do not
   reparse the JD. Interpret must-have, preferred and requirement relationships.
2. Map each requirement to direct evidence, transferable evidence, a gap, or
   ambiguity.
3. Preserve evidence maturity in every row: demonstrated, confirmed capability,
   familiar/basic exposure, or learning/aspirational. A confirmed capability
   may count as partial evidence without project provenance, but cannot be
   scored as demonstrated experience.
4. Explain the evidence behind each material match and expose verification
   questions instead of hiding gaps behind a score.
5. Produce tailoring priorities only after the evidence matrix is complete.

## TOOL BOUNDARIES

Use the high-level facade
`mcp__careeradapt__career_workflow_job_fit` when the user requests this
comparison. The facade reads the selected Job, confirmed Profile, and source
Resume, and may write only the fit artifact; it never writes a job claim into
the general Profile or modifies Resume content. Never call atomic Job tools.

## FACT SAFETY

Keyword overlap is not proof of skill, level, scope, or outcome. A job
requirement is never candidate evidence. Any new candidate claim stays pending
confirmation and cannot enter a preview or export.

## STOP CONDITIONS

Stop when the job source is missing, requirement identity is ambiguous, profile
evidence is not confirmed, or a requested recommendation requires an unsupported
claim. Return visible gaps instead of forcing an apply decision.

## RECOVERY

For stale job/profile data, reread the relevant revision and recompute the
affected requirement rows. For a missing job, refresh job discovery. For
validation or provider errors, preserve the parsed source and report the exact
step to retry; never mutate the general profile as recovery.

## OUTPUT

Core-02 contract: reuse the saved JobRequirementGraph for the selected Job version.
Carry `candidateEvidenceMatrix.analysisId` and its profile/resume/job revision
binding into tailoring and review. Keep unknown separate from mismatch; absence
in a Profile is not evidence that a candidate lacks a capability. Separate
must-have coverage, preferred coverage, evidence strength, material gaps and
unknowns. Coverage scores are diagnostics, never interview probabilities.

Return a requirement-to-evidence matrix, fit summary, material gaps, candidate
questions, confidence, and tailoring priorities. Include requirement IDs and
source references so later changes remain reviewable.

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

## FIT SUMMARY v2

For each important requirement return requirement, importance, current status,
existing evidence, potential transferable evidence, clarification value
(high/medium/low with reasons), gap type and tailoring opportunity. Retain
`direct / transferable / partial / unknown / conflicting / mismatch` and stable IDs.
Summarize Strong matches, Positionable matches, Worth clarifying, Real gaps,
and Low-value gaps. Real gaps require an explicit negative answer or blocker;
unknown never means “用户不会”. Explain must-have/preferred coverage, relevant
experience, transferability and important unknowns separately; no interview odds.
