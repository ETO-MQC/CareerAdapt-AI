# P4.2 Agent resume import boundary

## Shared production path

P4.2a.3c removes the former text bridge as the canonical Agent import path.
Both the manual Wizard and Agent now use the same deterministic application
pipeline:

1. The browser keeps the selected `File` in `AgentAttachmentStore` and exposes
   only an `AgentAttachmentRef` to task state and model context.
2. `prepare_resume_import({ attachmentId })` resolves the local file in the
   browser executor.
3. `ResumeImportOrchestrator.prepare()` validates and routes PDF, DOCX, or JSON
   through the existing extractors and adapters.
4. The orchestrator persists an `ImportedResumeDraft v2` and returns a compact
   review summary plus a `resume_import_review` artifact payload.
5. The user reviews uncertain source mapping and explicitly selects an
   existing or new profile target.
6. For an existing target, `reconcile_resume_import` creates a persisted,
   deterministic `ProfileReconciliationPlan`. Only likely duplicates and real
   field conflicts enter `resolve_resume_reconciliation`.
7. `commit_resume_import` requires `importId`, `expectedDraftRevision`, an
   explicit target, confirmation, and the current reconciliation revision for
   an existing Profile. The write remains
   `WorkspaceRepository.confirmImportedResume()`.
8. `import_resume` reaches `import_complete` only after the Repository returns
   authoritative Profile/Resume/Revision IDs.

No PDF bytes, base64, full extracted document text, or canonical JSON payload
is sent through model tool input.

## Orchestrator responsibilities

`ResumeImportOrchestrator` is UI-independent. It coordinates existing:

- PDF descriptor/header validation, PDF.js extraction, `preparePdfText`,
  normalized source blocks, `LayoutDocument`, `LayoutGraph`, and
  `ResumeSemanticTree`;
- import quality analysis and the existing optional OpenDataLoader route with
  deterministic PDF.js fallback;
- DOCX XML extraction;
- canonical JSON v2, v1-to-v2, Wenmo, and deterministic external JSON adapters;
- `ImportedResumeDraft v2` construction, evidence binding, invariant
  validation, and Repository draft persistence.

It emits `validating`, `extracting`, `normalizing`, `mapping`,
`building_draft`, `ready_for_review`, `fallback`, and `failed` progress events.
A ten-second heartbeat refreshes the AgentHost watchdog during long local
operations.

`ResumeImportWizard` now owns only file/paste input, visible progress, review
edits and selections, target choice, and final confirmation UI. OCR and the
advanced AI-assisted JSON recovery route remain manual recovery paths.

## Attachment and persistence semantics

`AgentAttachmentRef` persists safe metadata (`id`, file name, MIME type, size,
optional hash, and creation time). The actual `File` is transient and local to
the current browser host.

- After draft persistence, reload restores the review artifact without
  reparsing.
- Before draft persistence, lost source bytes produce
  `agent_attachment_lost` and the user-facing recovery “请重新选择文件”.
- Abort can stop file reading/parsing. It does not replay a confirmed write.
- Confirmed writes keep operation-ID idempotency and draft-revision checks.

## Capability status

- PDF: product/manual/Agent available; browser-proven through real PDF.js
  parsing and provenance persistence.
- DOCX: product/manual/Agent available; browser-proven through real DOCX
  extraction.
- JSON: product/manual/Agent available; browser-proven for canonical v2 and
  deterministic external adapters without text flattening.
- PNG/JPEG/OCR: still partial/manual. Agent OCR remains unavailable and is not
  represented as production-quality support.

`AgentComposer` derives its accepted attachment types from the same product
capability manifest. TXT is not declared as an Agent resume import format.

## Remaining limits

- OCR quality and scanned/image Agent import remain a separate future task.
- Matching is deterministic and conservative. Unsupported semantic aliases and
  custom sections may remain separate or require review; an LLM can only
  propose an unresolved match and can never mutate CareerProfile.

## P4.2a.3d reconciliation authority

The existing-Profile path is:

`ImportedResumeDraft → ProfileReconciliationEngine → ProfileReconciliationPlan
→ explicit unresolved decisions → confirmation-bound Repository mutation`.

The plan binds the draft revision and authoritative Profile version. A stale
Profile invalidates the plan before commit. Every incoming item has exactly one
decision: `exact_duplicate`, `evidence_extension`, `compatible_update`,
`likely_duplicate`, `conflict`, `new_fact`, or `keep_separate`.

Entity matching is type-specific. Skills split before canonical-name matching;
experience and project entries match entity identity separately from their
facts/bullets; certificate credential ID is primary but cannot hide conflicting
issuer/date fields. Materially different dates, organizations, roles, scores,
credential IDs, or quantitative claims are never silently replaced.

Evidence fusion reuses the existing Fact ID and appends provenance keyed by
source hash, source type, quote, and page locator. The append is idempotent.
Importing the same source/content again produces no Profile semantic change and
does not implicitly create another general Resume. Wizard and Agent are
different presentations over this same Repository plan.

## Runtime progress and watchdog contract

The Agent watchdog measures inactivity from `lastProgressAt`, not total task
duration from `startedAt`. Model deltas, tool status, artifact updates, import
progress, and heartbeat events refresh `lastProgressAt`.

Long-running extraction or manual OCR may legitimately exceed 30 seconds. It
is not stalled while heartbeats continue. The warning never authorizes an
automatic retry of a write operation.
