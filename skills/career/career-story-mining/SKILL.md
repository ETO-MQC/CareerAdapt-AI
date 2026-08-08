---
name: career-story-mining
description: Mine a candidate's raw experience narration into evidence-backed career story components without inventing achievements.
---

# Career story mining

## Inputs

- Exact candidate narration and source metadata.
- One existing career asset when the turn is a follow-up.
- Optional job context, clearly marked as job-specific rather than profile truth.

## Method

Extract only what the source supports:

- context and scope;
- the candidate's role and actions;
- methods, tools, or decisions;
- challenge and response;
- result, deliverable, or observable evidence;
- collaboration and ownership boundaries.

Preserve the original quote alongside normalized facts. Separate explicit
claims from reasonable interpretations, and mark the latter as needing review.
When several assets are mentioned, split them only when the source provides a
clear identity; otherwise ask one clarifying question.

## Output

Return candidate patches, evidence links, confidence, unresolved fields, and a
short next-question proposal. A patch must name its target asset and must not
replace unrelated assets.

## Boundaries

Do not add metrics, tools, titles, dates, employers, or outcomes that are not
in the source. Do not write directly to a profile or resume; the host owns
review, persistence, and revision conflict handling.
