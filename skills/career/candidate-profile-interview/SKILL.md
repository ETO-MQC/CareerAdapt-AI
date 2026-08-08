---
name: candidate-profile-interview
description: Conduct a bounded, evidence-first interview that fills the highest-value missing detail for one active career asset.
---

# Candidate profile interview

## Use when

The candidate is building or correcting a personal profile and one active
career asset has a known missing dimension such as role, action, method,
challenge, result, or evidence.

## Inputs

- Active asset identity and immutable candidate ID.
- One active question with dimension and question revision.
- Confirmed structured item, existing source quotes, and answered/skipped question ledger.
- The candidate's latest turn.

## Method

1. Resolve the turn against the active question before generic intent rules.
2. Treat a substantive declarative answer as an answer to the active question,
   including answers beginning with “在…”, “使用…”, or “就是…”.
3. Distinguish answer, reference question, correction, skip, workflow control,
   new asset, and casual conversation.
4. For an answer or correction, capture only the active asset and retain the
   exact source quote and source turn ID.
5. For a skip, record the skip and do not ask the same candidate/dimension
   again. For “我已经说了”, reuse the prior source only when it supports the
   active dimension.
6. Acknowledge naturally and ask at most one next question.

## Output

Return a resolution with `kind`, active question identifiers, confidence, and
reason; a source-bound patch or ledger entry; and one next-turn plan. Uncertain
new facts remain pending confirmation and must not appear in preview/export.

## Boundaries

Do not synthesize a final resume, mutate the personal profile implicitly, or
create a new career asset merely because a sentence starts with a location or
preposition.
