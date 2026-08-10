---
name: resume-tailoring
description: Tailor a job resume branch from confirmed evidence.
version: 1.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [tailoring, job-branch, diff, fact-safety]
    related_skills: [job-fit-analysis, resume-review]
---

# Resume tailoring

## WHEN TO USE

Use after job-fit analysis identifies an evidence-backed priority and a
job-specific resume branch has been selected. Keep the general resume and
profile immutable while proposing changes.

## INPUTS

- Target job and stable requirement IDs.
- Selected source resume or general profile branch and revision.
- Confirmed evidence, source quotes, and user-approved preferences.
- Fixed person/profile/session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the confirmed Profile, source Resume, target Job, and fit analysis before
planning any question or rewrite.

### WHEN TO ASK

Ask only when the answer can change match status, evidence selection,
tailoring strategy, or fact safety.

### WHAT NOT TO ASK

Do not ask for optional metadata, repeat known facts, or block tailoring on a
missing detail that can be handled as a visible conservative gap.

### QUESTION BUDGET

Use zero questions when possible and no more than three normal clarification
questions for one tailoring task.

### WHEN TO PROCEED

Continue conservatively when the user is unsure, preserve the unsupported
requirement as a gap, and wait only at the review or confirmation boundary.

### STOP CONDITION

Stop before applying or exporting when evidence, revision, or explicit
confirmation is missing.

### RECOVERY

Re-read stale inputs and regenerate only the affected proposal; never replay a
write or silently change the source branch.

## WORKFLOW

1. Prioritize evidence that is relevant, specific, and supported by the fit
   matrix.
2. Propose a reversible diff with section, source IDs/quotes, old value,
   proposed value, rationale, and confidence.
3. Prefer truthful emphasis, ordering, and concise wording before new content.
4. Run a separate review pass, surface unsupported requirements, and wait for
   explicit approval before applying or exporting.

## TOOL BOUNDARIES

Use `career.tailoring.*` and `career.preview.*` only through the host gateway.
Proposal generation is not a write. Applying a diff requires the host's
confirmation and revision checks; no skill code writes the repository.

## FACT SAFETY

Never invent achievements, metrics, titles, dates, or skills. A job
requirement cannot become a resume claim. Preserve unsupported requirements as
gaps or questions and keep provenance attached to each proposed line.

## STOP CONDITIONS

Stop when the source branch, job requirement, evidence, or revision is missing;
when review finds an unsupported claim; or when confirmation is not present.
Do not export a pending diff.

## RECOVERY

For stale revisions, reread the branch and regenerate only the affected diff;
never replay an apply write automatically. For a missing job/profile, refresh
discovery and ask for selection. For provider/MCP transient failure, preserve
the proposal and retry planning, not the write.

## OUTPUT

Return a requirement-to-evidence map, reversible diff items, provenance,
unsupported-claim warnings, confidence, review findings, and a confirmation
checklist. State clearly whether the result is proposal-only or approved.
