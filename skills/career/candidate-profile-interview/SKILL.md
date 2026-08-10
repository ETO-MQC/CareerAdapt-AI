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

## INTERACTION POLICY

### WHAT TO READ FIRST

Read the current Person/Profile version, confirmed assets, source turns, and
the answered/skipped ledger before interpreting the latest turn.

### WHEN TO ASK

Ask one question only when the answer is not already evidenced, changes the
quality or safety of the next career asset, and is the highest-value unresolved
gap. Use a budget of two high-value follow-ups per substantial asset; a good
asset may use zero.

### WHAT NOT TO ASK

Do not ask for an empty schema field, repeat an answered or skipped question,
or force project-style detail on education, awards, or already-ready assets.

### WHEN TO PROCEED

Proceed with a conservative draft when the candidate does not know, and keep
the missing dimension visible instead of inventing a fact.

### STOP CONDITION

Stop at one question, a true conflict, an explicit user correction, or a
review/confirmation boundary.

### RECOVERY

Re-read stale state, preserve the source quote, and re-plan without replaying
a write. Never turn a recovery step into a new factual assertion.

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
