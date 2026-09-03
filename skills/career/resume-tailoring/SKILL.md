---
name: resume-tailoring
description: Create or tailor a job-specific Resume when the user supplies or selects a target Job or JD, while keeping claims evidence-bound.
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

Use when the user supplies or selects a target Job or JD and asks for a
job-specific Resume to be created or tailored. A pasted JD may go directly to
this workflow; a prior Job Fit result is optional unless the user requested
Job Fit separately. Keep the general Resume and Profile isolated while
proposing target-specific changes.

Do not use for a general/base Resume, Job Fit-only comparison, importing a
resume, or reviewing a Resume without a target Job/JD.

## INPUTS

- Target Job/JD or supplied target text, with stable requirement IDs when they
  are already available.
- Selected source resume or general profile branch and revision.
- Confirmed evidence graph/blueprint, source quotes, and user-approved
  preferences.
- Fixed person/profile/session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the confirmed Profile, source Resume, and target Job/JD before planning
any question or rewrite. Incorporate an existing fit analysis when available;
do not require a prior Job Fit call for a pasted or newly supplied target.

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

Every proposal retains its checkpoint, source branch fingerprint, and base
revision. A stale source, job, or Profile creates a new proposal; it never
replays an old write.

## GAP SCORECARD

Before drafting, map each important requirement to one explicit state:

- `covered`: confirmed evidence already supports the requirement;
- `rewriteable`: existing evidence can be reordered or expressed more clearly;
- `confirmable`: a user answer may add a branch-scoped claim;
- `material_only`: keep it as a preparation task or evidence request;
- `uncovered`: show the gap and do not stuff the keyword.

Each row keeps requirement IDs, evidence refs, candidate items, missing
keywords, and clarification IDs. Ask no more than three high-value questions;
do not block a safe resume-only draft on optional detail.

## WORKFLOW

1. Read the composition evidence graph/blueprint or build the bounded
   job-specific context, then produce the gap scorecard before prioritizing
   evidence that is relevant, specific, and supported by the fit matrix.
2. Propose a reversible diff with section, source IDs/quotes, old value,
   proposed value, rationale, and confidence.
3. Prefer truthful emphasis, ordering, and concise wording before new content.
4. Run a separate global review pass. Separate evidence eligibility from final
   exact-keyword presence, retain unsupported requirements as visible gaps, and
   perform at most one safe ATS repair for an exact supported concept. Run
   Fact Guard and the reviewer again before approval.
5. Wait for explicit approval before applying or exporting. A confirmed claim
   defaults to `resume_only`; `resume_and_profile` is a separate explicit
   choice that creates a confirmed Profile fact, records `user_input`
   provenance, and increments the Profile revision.

## TOOL BOUNDARIES

Use only the high-level facade
`mcp__careeradapt__career_workflow_tailor_resume` through the host gateway.
It owns target selection, proposal/review checkpoints, and the confirmation
boundary. Proposal generation is not a write; applying a target-specific
change requires host confirmation and revision checks. Never call atomic
tailoring or preview tools and never write the repository from Skill code.

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
the proposal/checkpoint and retry planning, not the write. A source branch
change aborts the apply transaction.

## OUTPUT

Return a requirement-to-evidence map and gap scorecard, reversible diff items,
provenance, unsupported-claim warnings, evidence-eligibility versus final ATS
coverage, confidence, review findings, and a confirmation checklist. State
clearly whether the result is proposal-only or approved.
