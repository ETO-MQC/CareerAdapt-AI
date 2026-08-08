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
