# Diff-Based Resume Tailoring V3

## 1. Audit findings

The current pipeline already has useful ingredients—typed `ResumeFieldPatch`, cross-item evidence recall, Fact Guard policy, clarification questions and repository revisions—but they are connected through a suggestion/claim abstraction that treats most operations as text rewrites.

Root causes:

- `createDeterministicTailoringSuggestions()` calls `rewriteField()` and generates complete prose, including the proactive mechanical prefix. A deterministic routing layer is therefore authoring facts and style.
- AI output contains only `after`; the registry reconstructs target/original/operation and can hide protocol mistakes.
- `validateTailoringDelta()` applies one text-change-ratio policy to replace/reorder-like suggestions.
- `answerTailoringClarification()` returns the original plan for a negative answer, so the question is visually answered but semantically unresolved.
- Repository application is plan-transactional. One invalid patch can throw while iterating and prevent all otherwise valid patches from applying.
- Generic keyword filters discard entire phrases such as `Coding Agent` and `Vibe Coding` instead of lowering only standalone generic tokens.
- The panel derives active questions from array position and renders a prefix/suffix diff, which is insufficient for Chinese edits and highlight arrays.

## 2. Clean-room upstream borrowing matrix

| Upstream idea | Adopt | Adaptation |
| --- | --- | --- |
| Minimal model changes rather than full resume output | Yes | Reuse `ResumeFieldPatch`; model returns `ResumeTailoringDiff` only |
| Path allow-list and protected fields | Yes | ID-based Resume Schema v2 target plus section/field allow-list |
| Exact original verification | Yes | Strict typed equality against the current `ResumeRevision` |
| Per-change applied/rejected result | Yes | Reason-coded results; one rejection never cancels other valid diffs |
| Local post-apply verification | Yes | Identity, style/presentation, non-target normalized equality and metric checks |
| Full reconstructed resume returned to frontend | No | Preview contains selected typed patches only |
| Python dot/bracket index paths | No | Stable `sectionId + itemId + fieldPath` |
| Whole-resume refinement passes | No | Would bypass Field Patch and revision boundaries |
| Reorder salvage with additions/removals | No | Reorder requires an identical multiset |
| Upstream wording/prompt/code | No | Project-specific TypeScript implementation and prompt written from this contract |

No upstream source is copied or modified. `THIRD_PARTY_NOTICES.md` is therefore not required for this implementation. If later review finds copied code, the notice file and Apache 2.0 attribution become mandatory before commit.

## 3. Data flow

```text
analyzeJobRequirements
  -> buildRequirementEvidenceMatrix
  -> analyzeKeywordAndCapabilityGaps
  -> createTailoringPlan
  -> generateTargetedDiffs
  -> validateEachDiffLocally
  -> retryRejectedDiffsOnce
  -> collectClarificationAnswers
  -> generateConfirmableDiffs
  -> previewFinalPatches
  -> applyThroughWorkspaceRepository
  -> recalculateCoverage
```

Each stage is a headless service with Zod input/output schemas, `operationId`, abort support and stable error codes. UI state stores command results; it does not implement domain decisions.

## 4. Canonical diff and gap contracts

`ResumeTailoringDiff` targets exactly one `sectionId`, `itemId` and whitelisted field. It carries:

- operation: `replace | reorder | append | hide`
- exact `original` and typed `value`
- reason, requirement IDs and target keywords
- evidence refs and `verified | reasonable_inference | user_declared`

`TailoringGap` is requirement-scoped:

- `covered`: current job branch evidence covers it
- `rewriteable`: existing branch/profile evidence supports a different expression
- `confirmable`: plausible capability requires a user answer
- `material_only`: application evidence is required, not resume prose
- `not_applicable`: user explicitly rejected or requirement is irrelevant to their situation
- `uncovered`: no evidence or safe clarification path

Literal keyword absence alone never produces `uncovered`.

## 5. Operation-specific validation

### Common four gates

1. Target item/path exists in the current revision.
2. Section and field are on the allow-list.
3. `original` strictly equals the typed current value.
4. The mutation does not affect a blocked identity, factual metadata or presentation field.

### Replace

Reject empty/no-op/truncated/mechanical-prefix/duplicated-original output, invented metrics, identity changes, responsibility upgrades and unsupported tools. `textChangeRatio` is diagnostic only. Conservative low-delta improvements may pass if a real phrase/clarity/format improvement exists.

### Reorder

The before and after arrays must have identical multisets including duplicates. No text-change ratio applies.

### Append

Only `highlights` and skills are eligible. Evidence must be verified or a confirmed user declaration. It defaults to confirmation and is never silently applied.

### Hide

Only `visible: true -> false`; no record is deleted. The operation is reversible through the existing revision chain.

Validation returns:

```ts
{
  appliedDiffs,
  rejectedDiffs: [{ diff, reasonCode }],
  warnings
}
```

The repository receives only validated, selected patches. If none remain, it creates no revision.

## 6. Protected and allowed fields

Blocked: name, organization/company, school, degree, immutable specialty facts, dates, location, awards, certificates, project title, work title, template, style, page settings and section presentation config.

Allowed:

- summary `text`
- skills `name`/`description` when equivalent or confirmed
- project/work/internship `description`/`highlights`
- item `visible`
- item `order`

Skills append is a confirmed capability, never a silent lexical rewrite.

## 7. Intensity semantics

- **conservative**: equivalent terminology, compression, bullet order, punctuation/format cleanup and responsibility-preserving verbs. No new capability claim.
- **balanced**: reorganize existing facts using JD language and highlight relevant method/judgment/validation/outcome. `reasonable_inference` requires confirmation.
- **proactive**: create clarification questions for tool/workflow/proficiency/case gaps, then generate final text from answers. It never adds a generic prefix and never treats missing literal keywords as proof of missing capability.

Deterministic code performs routing, recall, gap analysis, ranking, reorder proposals, validation and safety gates only. It does not write full summary or bullet prose.

## 8. Phrase-aware keyword taxonomy

Taxonomy entries have `phrase`, `type`, aliases and weight:

- exact phrase
- technical term
- action phrase
- workflow
- domain term
- soft signal
- semantic alias

Longest phrases match first. Standalone `AI`, `Coding` and `Agent` receive low weight, but complete phrases such as `AI Coding`, `Coding Agent`, `Vibe Coding`, `AI Agent`, `复杂多轮指令`, `模型评测`, `Prompt Engineering`, `RAG`, `Verifier`, `Benchmark` and `Badcase` are retained.

## 9. Clarification state

`ClarificationAnswerRecord` is persisted in the plan/session:

- accepted
- rejected
- skipped

Negative answers save `rejected`, complete the question, generate no claim, display “已确认不添加”, stop repeat prompts and do not count as unanswered.

The active question is an ID, not a mutable filtered-array index. Progress is derived from all question IDs and answer records. After an accepted answer, the generator creates a concrete final candidate sentence; proficiency/edit confirmation follows that sentence.

## 10. UI contract

Suggestion groups:

1. directly applicable
2. add after confirmation
3. needs answer
4. application materials
5. unchanged/deprioritized

Cards expose location, before, after, reason, covered requirements, new keywords, risk and evidence by default. The final page contains only selected writes and disables saving when the selection is empty.

String display uses token/word-level LCS with Chinese grouping. Highlight arrays are diffed bullet-by-bullet; they are never flattened into one joined string.

The UI preserves current CareerAdapt density, scrolling model and action hierarchy. It adds no unified AI conversation workspace.

## 11. Headless command boundary

The following commands are the stable UI-independent interface:

- `analyzeJobCommand`
- `createTailoringSessionCommand`
- `generateTailoringDiffsCommand`
- `answerTailoringQuestionCommand`
- `previewTailoringChangesCommand`
- `applyTailoringSessionCommand`

Commands are replayable through deterministic IDs, accept an `AbortSignal`, return typed error codes, and do not mutate React state. Only the apply command writes formal data, and it delegates to `WorkspaceRepository`.

## 12. Compatibility and risks

- Existing `ResumeTailoringPlan` and `TailoringSuggestion` records are adapted on read into sessions/diffs. Current Field Patch remains the sole formal patch.
- Existing repository branch/revision isolation remains unchanged.
- Presentation is snapshot-compared before/after application; only targeted content fields may differ.
- A model may return invalid original/path values. Those diffs are rejected and retried once individually.
- A confirmed append may be supported by a user answer but lack profile evidence. It remains `user_declared`, resume-only, and does not sync to profile unless separately triggered by the user.
- Existing plan records without answer records derive unanswered state from their clarification questions.
- Estimated score deltas are coverage estimates, not ATS or hiring probabilities.

## 13. Verification contract

Unit coverage includes phrase taxonomy, operation-aware validation, exact-original, identity blocking, partial apply, cross-item evidence, negative answers, no-empty-revision and style invariants.

Integration covers raw JD through V4 graph, evidence/gap/plan/diffs/clarification/preview/repository revision/recalculated coverage/undo.

Targeted Playwright covers the two JD fixtures and one full apply/undo flow. Full historical four-shard Playwright is outside this feature gate.
