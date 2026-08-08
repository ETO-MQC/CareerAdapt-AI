# CareerAdapt portable skills

This folder contains five portable, evidence-first career skills. Each
`SKILL.md` follows Hermes portable-skill metadata and section conventions, but
the documents remain workflow guidance: they do not depend on CareerAdapt's
`AgentKernel`, browser state, or a vendor SDK.

Each skill preserves these boundaries:

- Treat candidate statements, imported documents, and profile facts as separate evidence sources.
- Never invent a fact, metric, employer, title, date, tool, or outcome.
- Keep job-specific tailoring separate from the general profile.
- Mark uncertainty and ask for confirmation before a new fact appears in a resume, preview, or export.
- Return structured work products plus source references, not only prose.

## Skills

1. `candidate-profile-interview` — ask the smallest useful next question and capture the answer against the active career asset.
2. `career-story-mining` — turn raw experience narration into evidence-backed story components.
3. `job-fit-analysis` — compare a job description with confirmed profile evidence and expose matches and gaps.
4. `resume-tailoring` — propose job-specific resume changes without changing the source profile.
5. `resume-review` — review a resume for factual support, clarity, relevance, and unsupported claims.

The host application owns persistence, confirmation, revision checks, and
export. These skills describe reasoning and structured outputs only. The
Hermes runtime must call the host's `career.*` gateway; it must not write local
storage directly.
