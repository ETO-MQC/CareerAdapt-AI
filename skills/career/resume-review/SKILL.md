---
name: resume-review
description: Review a resume for factual support, relevance, clarity, and risk without rewriting unsupported claims as facts.
---

# Resume review

## Inputs

- Resume branch and revision identifier.
- Target job, if the review is job-specific.
- Profile evidence and provenance available for included claims.

## Method

Check each material claim for source support, then review:

- clarity and concrete ownership;
- relevance to the target job;
- result and scope specificity;
- chronology and internal consistency;
- unsupported metrics, inflated titles, and ambiguous wording;
- structure, readability, and likely extraction/ATS issues.

Separate factual risk from style preference. Quote the affected text and give a
minimal suggested revision only when the evidence supports it.

## Output

Return findings with severity, location, evidence status, recommendation, and
whether user confirmation is required. Include a short release checklist for
preview and export.

## Boundaries

Review does not authorize a write. Never manufacture a stronger result to make
the resume sound better, and never treat a job description as evidence about
the candidate.
