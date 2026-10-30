---
name: resume-review
description: Review or improve an existing general Resume for evidence, clarity, and release risk without a target Job.
version: 2.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [resume, review, release, fact-safety]
    related_skills: [job-fit-analysis, resume-tailoring]
---

# Resume review

## WHEN TO USE

Use when the user asks what is wrong with an existing Resume or asks to improve
it without naming a target Job/JD. Identify the selected/current general Resume
and return review findings; an improvement request may continue through the
same general-resume update boundary.

Do not use for a target-specific Resume, Job Fit comparison, document import,
or creating a new general Resume from Profile evidence.

## INPUTS

- Resume branch or composition result, revision identifier, and
  rendered/text-layer representation.
- Optional selected general Resume ID and revision identifier.
- Profile evidence and provenance for every material included claim.
- Fixed person/profile/session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Inspect the selected Resume revision, text layer, Profile evidence, and
existing review findings after the review capability is activated. Do not
pre-read personal data before Hermes receives the user's turn.

### WHEN TO ASK

Ask only for a true factual conflict, a style trade-off, one-page versus
content retention, explicit removal, or a confirmation boundary.

### WHAT NOT TO ASK

Do not ask the user to diagnose layout, PDF, pagination, or unsupported-claim
problems; diagnose those issues in the review.

### QUESTION BUDGET

Use zero questions for ordinary inspection and at most one focused decision at
each user confirmation boundary.

### WHEN TO PROCEED

Proceed with the review and report a visible finding when a safe conservative
choice is available.

### STOP CONDITION

Stop release when evidence, confirmation, revision freshness, text-layer
parity, or layout inspection is incomplete.

### RECOVERY

Re-read only the affected revision or artifact, preserve the finding, and
retry the diagnostic step without modifying user content.

## WORKFLOW

1. Check each material claim for source support and confirmation status;
   classify it as supported, derived presentation, needs confirmation, or
   unsupported, and hold unsupported text out of preview.
2. Review ownership, relevance, result/scope specificity, chronology,
   consistency, unsupported metrics, inflated titles, and ATS extraction risk.
3. Separate factual risk from style preference and quote affected text.
4. Run one bounded safe ATS repair only for an exact keyword already supported
   by source evidence; rerun Fact Guard and the reviewer, and distinguish
   evidence eligibility from whether the final text contains the exact term.
5. Review one-page density, page count, section balance, compression decisions,
   and text-layer parity. Verify that the preview text layer matches the
   reviewed content before export.

6. Return meaningful review diffs for each material change: remove, rewrite,
   verify, deduplicate, or shorten, with item ID, field path, before text, and
   recommendation. Flag maturity mismatches, mechanical AI wording, empty
   adjectives, and job-description parroting separately from factual risk.
   Preserve the source revision and never turn a review suggestion into a
   Profile write.

## TOOL BOUNDARIES

Review is read-only by default. Use
`mcp__careeradapt__career_resume_list` only when needed to identify the
selected/current general Resume, then use
`mcp__careeradapt__career_workflow_compose_resume` with `mode: "general"`, the
selected `sourceResumeId`, and `generalResumeMode: "update_existing"` for the
review/update capability. Stop at its proposal for review-only requests; an
improvement may continue through the same facade only after explicit user
confirmation. Never call atomic review, tailoring, or export tools and never
edit `WorkspaceRepository` directly.

## FACT SAFETY

Never strengthen a result, add a metric, or treat a job description as
candidate evidence. A suggested revision is valid only when its supporting
evidence is explicit and confirmed.

## STOP CONDITIONS

Stop release when any included claim lacks evidence, confirmation is pending,
the selected revision is stale, the text layer differs from the reviewed
content, or layout/PDF inspection has not completed.

## RECOVERY

For stale data, reread the branch and rerun only affected findings. For a
render or PDF failure, preserve the reviewed revision and report the artifact
step to retry. For an unsupported claim, return it as a blocking finding; do
not silently repair it.

For an ATS gap, retain a visible `missing-but-supported` or
`correctly-absent` status. Never invent a keyword, metric, tool, or ownership
claim to improve the score.

## OUTPUT

Core-02 contract: keep Job Fit, content quality and ATS/structure diagnostics
separate. Reuse the version-bound evidence matrix when one exists. Truth,
ownership and target/revision safety are hard gates; prose quality cannot
offset them. PDF text extractability and reading order remain unknown until
the actual renderer/export has been checked.

Return findings with severity, location, evidence status, recommendation,
confirmation requirement, evidence-eligibility versus final ATS coverage,
page/compression metrics, and a preview/export release checklist. Include the
reviewed branch and revision in every result.

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

## FOUR REVIEW PERSPECTIVES v2

A. Recruiter / HR Scan: first-screen positioning, target relevance, strongest
experience visibility, long bullets, AI boilerplate, inflated self-praise,
implausible jumps and rapid comprehension. Quote the affected line and propose
one specific fix; without the actual first screen, visual salience is unknown.
B. Content Quality: action, scope, method, result when known, specificity,
clarity, relevance, redundancy and ownership. Missing metrics alone is no defect.
C. ATS: parseability, reading order, sections, exact supported terms, semantic
coverage, missing-but-supported terms and keyword stuffing. Text extraction and
reading order require the real Preview/PDF; never claim them from prose alone.
D. Claim Risk: independent `low / needs_confirmation / high_risk` warnings.
A conversational user confirmation counts; Profile omission is not a risk by itself.

Score contract v2: keep Job Match, Resume Quality and ATS independent, explain
their dimensions and evidence. Prefer Strong / Good / Needs work or dimension
observations until calibrated weights exist. No interview probability or made-up
0–100 precision. Claim Risk is a warning/release layer, never averaged into
other scores. Tailoring uses this same review lens inside its facade; do not
route a target Resume into the general update workflow.
