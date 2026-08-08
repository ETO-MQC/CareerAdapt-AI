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

## P4.4b adapted workflow notes

Use a staged loop: select the target branch, draft evidence-backed changes,
run a separate reviewer pass, revise only supported changes, then compile and
inspect the render. Preserve unsupported requirements as gaps or questions;
do not turn them into resume claims. Every proposed change stays reversible
until the user approves the diff and the branch passes final verification.

Adapted from MadsLorentzen/ai-job-search's apply → reviewer → revise →
compile/inspect workflow and the resume handoff in
yanliudesign/offer-toolkit-skill. The branch isolation and CareerAdapt AI
Fact Guard remain authoritative.
