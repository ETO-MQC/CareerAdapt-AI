---
name: resume-review
description: Review resumes for evidence, clarity, and release risk.
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

Use before preview or export, after a resume branch, composition draft, or
tailoring diff has been prepared. Review the selected branch and revision
only; a new composition should also pass the evidence-graph/blueprint review.

## INPUTS

- Resume branch or composition result, revision identifier, and
  rendered/text-layer representation.
- Target job when the branch is job-specific.
- Profile evidence and provenance for every material included claim.
- Fixed person/profile/session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Inspect the selected Resume revision, text layer, Profile evidence, Job
context, and existing review findings autonomously before asking the user.

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
4. Verify that the preview text layer matches the reviewed content before export.

## TOOL BOUNDARIES

Review is read-only by default. The host may call
`career.resume.review_composition`, `career.resume.get`, preview, or export
contracts, but this skill never authorizes `career.*` writes and never edits
`WorkspaceRepository` directly.

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

## OUTPUT

Return findings with severity, location, evidence status, recommendation,
confirmation requirement, and a preview/export release checklist. Include the
reviewed branch and revision in every result.
