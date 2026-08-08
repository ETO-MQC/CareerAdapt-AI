---
name: resume-tailoring
description: Propose a job-specific resume branch from confirmed evidence while preserving the general resume and profile boundaries.
---

# Resume tailoring

## Inputs

- Target job and requirement IDs.
- Selected source resume or general profile branch.
- Confirmed evidence and any user-approved tailoring preferences.

## Method

Prioritize evidence that is both relevant and specific. Propose changes as a
diff: section, source fact IDs/quotes, old value, proposed value, rationale,
and confidence. Prefer reordering, concise wording, and truthful emphasis
before adding new content. Flag missing evidence instead of filling it.

Keep every proposal reversible and reviewable. A user correction must update
the proposal's provenance; it must not silently rewrite the source profile.

## Output

Return a requirement-to-evidence map, proposed diff items, unsupported-claim
warnings, and a confirmation checklist. Applying the diff is a separate user
approved action.

## Boundaries

Do not invent achievements or alter the general resume/profile while producing
a job branch. Do not export until all included facts are confirmed and the
final diff has passed review.
