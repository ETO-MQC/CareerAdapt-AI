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

Use before preview or export, after a resume branch or tailoring diff has been
prepared. Review the selected branch and revision only.

## INPUTS

- Resume branch, revision identifier, and rendered/text-layer representation.
- Target job when the branch is job-specific.
- Profile evidence and provenance for every material included claim.
- Fixed person/profile/session binding.

## WORKFLOW

1. Check each material claim for source support and confirmation status.
2. Review ownership, relevance, result/scope specificity, chronology,
   consistency, unsupported metrics, inflated titles, and ATS extraction risk.
3. Separate factual risk from style preference and quote affected text.
4. Verify that the preview text layer matches the reviewed content before export.

## TOOL BOUNDARIES

Review is read-only by default. The host may call `career.resume.get`, preview,
or export contracts, but this skill never authorizes `career.*` writes and
never edits `WorkspaceRepository` directly.

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
