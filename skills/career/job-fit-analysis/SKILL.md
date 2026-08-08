---
name: job-fit-analysis
description: Analyze fit between a job description and confirmed candidate evidence, including gaps and verification needs.
---

# Job fit analysis

## Inputs

- Parsed job description with requirements and responsibilities.
- Confirmed profile facts and career assets with source evidence.
- Optional target resume branch, kept separate from the general profile.

## Method

Normalize requirements into skills, experience, scope, domain, outcomes, and
constraints. Map each requirement to supporting evidence or mark it as a gap.
Distinguish:

- directly supported;
- partially supported or transferable;
- unsupported and needing candidate confirmation;
- irrelevant or ambiguous.

Explain the evidence behind each important match. Never convert keyword
similarity into a claimed skill or level.

## Output

Return a fit summary, evidence-backed matches, material gaps, questions that
could close those gaps, and tailoring priorities. Include requirement IDs so
later resume changes can be reviewed.

## Boundaries

Job requirements are not candidate facts. Do not write them into the general
profile, and do not recommend a claim that lacks source evidence.
