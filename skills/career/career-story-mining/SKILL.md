---
name: career-story-mining
description: Mine career stories without inventing facts.
version: 1.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [stories, evidence, provenance, fact-safety]
    related_skills: [candidate-profile-interview, resume-tailoring]
---

# Career story mining

## WHEN TO USE

Use when raw candidate narration needs to become a reviewable set of career
story components for a profile or a job-specific branch.

## INPUTS

- Exact narration and source metadata, including source turn or attachment.
- One existing career asset when the turn is a follow-up.
- Optional job context marked as job-specific, never as profile truth.
- Fixed `personId`, `profileId`, profile revision, and Agent Session binding.

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the complete current turn, existing assets, source evidence, and prior
answers before splitting or enriching anything.

### WHEN TO ASK

Ask one natural clarification only when asset identity, ownership, or an
outcome-changing detail cannot be safely resolved from the source.

### WHAT NOT TO ASK

Do not ask the user to name schema fields, enumerate every canonical slot, or
repeat facts already present in the source or Profile.

### QUESTION BUDGET

Use at most one question per turn and prefer broad acknowledgement before
selecting one high-value asset gap from a multi-asset narrative.

### WHEN TO PROCEED

Proceed with separated, evidence-bound candidates when the source is clear;
leave optional enrichment as an explicit gap.

### STOP CONDITION

Stop when identity, ownership, or asset separation would require an
unsupported inference.

### RECOVERY

Preserve the original turn, refresh the relevant asset, and ask only the
smallest clarification needed to re-anchor the proposal.

## WORKFLOW

1. Extract only context, scope, role, actions, methods, challenge, response,
   result, deliverable, collaboration, and ownership boundaries supported by
   the source.
2. Preserve the exact quote beside every normalized candidate fact.
3. Separate explicit claims from interpretations that need review.
4. Split multiple assets only when the source gives each a clear identity;
   otherwise ask one clarifying question.

## TOOL BOUNDARIES

Return a proposal for the host to validate. The skill may request safe reads
through the `career.*` gateway, but it never writes a profile, resume, or job
branch and never accesses `WorkspaceRepository` directly.

## FACT SAFETY

Do not add metrics, tools, titles, dates, employers, scope, or outcomes absent
from the source. Job requirements and model suggestions are not evidence.
Uncertain facts remain pending confirmation and are excluded from export.

## STOP CONDITIONS

Stop when source provenance is missing, two assets cannot be separated, the
candidate disputes a normalization, or the requested claim exceeds the source.

## RECOVERY

For a stale profile revision, reread and rebase only the proposed patch. For a
missing asset, refresh discovery and request a selection. For malformed input,
return the preserved quote and a targeted clarification; do not retry a write.

## OUTPUT

Return target asset IDs, candidate patches, exact evidence links, confidence,
unresolved fields, and one next-question proposal. Each patch must be scoped
to one asset and must not replace unrelated facts.
