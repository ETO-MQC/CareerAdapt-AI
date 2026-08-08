---
name: candidate-profile-interview
description: Interview for one evidence-bound career gap.
version: 1.0.0
author: CareerAdapt AI
license: Project-local
metadata:
  hermes:
    category: career
    tags: [profile, interview, evidence, fact-safety]
    related_skills: [career-story-mining, resume-review]
---

# Candidate profile interview

## WHEN TO USE

Use when one active career asset has a material missing dimension such as role,
action, method, challenge, result, or evidence. Keep the question attached to
the selected asset and the current Agent Session.

## INPUTS

- Active `personId`, `profileId`, profile revision, and `agentSessionId`.
- One active question with its dimension and question revision.
- Confirmed structured facts, source quotes, and answered/skipped ledger.
- The candidate's latest turn.

## WORKFLOW

1. Resolve the turn against the active question before generic intent rules.
2. Classify answer, correction, skip, reference, workflow control, new asset,
   or casual conversation.
3. Capture only the active asset and retain the exact source quote and turn ID.
4. Record a skip so the same question is not asked again.
5. Ask at most one highest-value next question and leave gaps visible.

## TOOL BOUNDARIES

Return a proposed source-bound patch or ledger entry to the host. Only the
host may call `career.profile.capture_intake` or `career.profile.commit_intake`;
the skill never writes to `WorkspaceRepository` directly.

## FACT SAFETY

Never infer a metric, title, date, employer, tool, ownership boundary, or
outcome. New claims remain pending confirmation and cannot enter preview or
export until the host validates their evidence.

## STOP CONDITIONS

Stop and ask for clarification when the target asset or question revision is
missing, the answer supports multiple assets, or the candidate disputes the
source. Stop before synthesis when evidence is ambiguous.

## RECOVERY

For a stale revision, reread the active asset and rebase the proposal without
repeating a write. For a missing asset, refresh discovery and ask the host to
select one. For validation or provider failure, preserve the quote and ledger
state and return a concise retry instruction.

## OUTPUT

Return a structured resolution with `kind`, question identifiers, confidence,
reason, source-bound patch or skip entry, unresolved fields, and one next-turn
plan. Include no unconfirmed resume-ready prose.
