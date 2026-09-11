# CareerAdapt AI — P4.8c.1 Final Report

A. Starting HEAD: `d7eddf4a0831766591f257a4f796201fa99a8fd7`. Final repository HEAD is unchanged because no commit was requested.

B. Frozen baseline: **9/20** (`docs/testing/p48c-before.json`). AFTER: **20/20** (`docs/testing/p48c-after.json`). The same 20 assertions were retained after baseline.

C. Existing-rule mapping: Fact Guard, provenance, maturity, ownership, ResumeRevision, review ledger and tailoring diff guards were already present and retained. Quality dimensions were partial in `CareerResumeQualityPolicyV1`, Writer, Blueprint and Reviewer; role preference resolution was missing. The detailed audit is in `docs/architecture/p4.8c.1-corpus-calibration.md`.

D–E. Generic quality and Composition: `CareerResumeQualityPolicyV1` remains the only policy. It now encodes truth → relevance → evidence → clarity → concision → polish, contextual genericity, optional method/result/metric, semantic atomicity, index/proof skills, and page utility. Blueprint no longer synthesizes a Summary by default. Writer keeps punctuation inside a causal chain and follows Blueprint ordering.

F. Preserve-first Review: existing review diffs now support KEEP_STRONG as no-op, TIGHTEN, REWRITE, VERIFY, DEDUPLICATE and REMOVE_CANDIDATE semantics. Strong bullets remain untouched. Independent achievements receive a split suggestion; long causal chains do not split by length.

G. Tailoring: existing evidence reranking and hard guards remain. The prompt explicitly rejects JD parroting and fact creation, preserves strong content, and allows backend emphasis to elevate supported service/data/reliability evidence without deleting AI evidence.

H–J. Role preference: one static resolver is applied after truth, maturity, evidence and relevance eligibility. AI/LLM/Agent/RAG is HIGH confidence; backend, frontend and infrastructure are MEDIUM; product, data and growth are PROVISIONAL. Unsupported roles use generic rules. There are no role-specific writers or persisted role data.

K. Uncalibrated fallback: government/admin, finance, legal, medical, academic CV, design, sales, HR and unknown roles use generic quality policy only.

L. Summary: optional. No Summary is generated merely because a section exists. An AI-provided Summary must add evidenced positioning and cannot be generic or redundant. Missing Summary is never a defect.

M. Metrics: verified metric > verified scale/range > verified qualitative outcome > no outcome. Generated unsupported precision is blocked by existing Fact Guard. User-origin precision lacking support is preserved with a VERIFY proposal.

N. Genericity: no blacklist for `提升`, `优化`, `高效`, `稳定`, `赋能` or `用户体验`. Warnings use task/object, action, mechanism, scope and evidence together; evidence-backed positive wording is retained.

O. Skills: Skills remain a compact index; Work/Projects remain proof. A skill repeated as index and concrete evidence is allowed. Long unsupported catalogs receive compression suggestions and project display rows use the existing eight-tool compact limit.

P. Page utility: no universal one-page defect. Under explicit page pressure, generic/redundant Summary and catalogs are candidates before strong, relevant, differentiating evidence. Existing pagination and presentation architecture remains unchanged.

Q–R. Eval: **20/20 after**, fixing cases 03, 06, 07, 08, 11, 12, 13 and 15–18. Focused final run: **25/25** (`docs/testing/p48c-final-focused.json`).

S. Same-profile acceptance: one confirmed synthetic CareerProfile produced General, AI-target and backend-target branches through `WorkspaceRepository`. Facts and factRefs are unchanged; AI prioritizes retrieval and backend prioritizes service/API/Redis evidence; strong bullets remain and no metric or ownership upgrade appears. See `docs/testing/p48c-same-profile.md`.

T. Hard guards: ownership, maturity, provenance, unsupported metric blocking and no silent Profile synchronization remain authoritative. Existing P4.6a, P4.6b, P4.8a, P4.8b and composition-write regressions pass.

U. Production footprint: 9 existing production files, approximately **+141 / -68 lines** (net +73), no new production file. Tests/fixtures/docs were added for the frozen cases and acceptance.

V. Hermes/Runtime/MCP modified? **NO.**

W. Profile/Resume/Template architecture modified? **NO.** No new dependency, Dexie table, schema, Agent or MCP tool.

Full gates: `pnpm test` **1354/1354**, `pnpm typecheck` **0**, `pnpm lint` **0**, production `pnpm build` using an isolated `.next/p48c-build-final` **0**, and `git diff --check` **0**. Career Agent Eval was started twice; the first run collided with a shared `.next/integration-*` directory, and the fresh retry emitted only MCP heartbeats for several hours without a completed case report. It was stopped under the long-test timeout rule and is recorded as incomplete in `docs/testing/p48c-gates.json`; it is not counted as a pass. No live Provider or subjective user-quality acceptance was claimed, and no Electron package was rebuilt.

The sanitized deterministic code path is ready for the user to perform real acceptance; live Provider and subjective acceptance remain outstanding.

P4.8c.1 corpus-calibrated Resume writing ready for real-user acceptance? YES
