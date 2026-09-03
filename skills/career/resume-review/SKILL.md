---
name: resume-review
description: Review or improve an existing general Resume for evidence, clarity, and release risk without a target Job.
version: 1.0.0
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

Return findings with severity, location, evidence status, recommendation,
confirmation requirement, evidence-eligibility versus final ATS coverage,
page/compression metrics, and a preview/export release checklist. Include the
reviewed branch and revision in every result.
