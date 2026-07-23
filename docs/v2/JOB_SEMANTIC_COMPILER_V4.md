# Job Semantic Compiler V4

## Status and audit baseline

- Implementation baseline branch: `main`
- Implementation baseline HEAD: `4a455101884cf43df3fb3f498ebc570b47f5641b`
- GitHub review reference supplied for comparison: `59f6e8adb6c09eb0821af44eb68b589503110bf6`
- Baseline worktree: clean; no staged or unstaged user changes
- Baseline checks: `pnpm typecheck` passed; 5 directly related unit files, 44 tests passed
- Upstream reference: `srbhr/Resume-Matcher` at `dd9b5c3b7a341a62c3a86f7a84e8e30786e6153d`
- License review: Apache License 2.0; no upstream `NOTICE` file exists at the reviewed commit

This document is the implementation contract for the requested V4 compiler. It does not authorize the later unified AI conversation workspace, PDF/import/template changes, Dexie schema changes, Fact Guard threshold changes, or writes outside `WorkspaceRepository`.

## 1. Reusable design

| Design idea | Source | CareerAdapt adaptation |
| --- | --- | --- |
| Generate a minimal semantic/diff protocol instead of reproducing protected structures | Resume-Matcher diff design | AI returns one assignment per deterministic source unit; it never returns source text or a compiled graph |
| Allow-list targets and block identity/metadata paths | `improver.py` diff applier | Ledger assignments may only alter semantic fields; source unit ID/text/span remain immutable |
| Compare model-declared original state with current state | `apply_diffs()` | Every assignment ID must resolve to the current provisional ledger; parents must resolve in the same ledger |
| Reject invalid entries independently | `apply_diffs()` | Invalid AI assignments degrade only their source units to provisional/local results |
| Preserve the original object as the source of truth | diff design spec | Raw JD and deterministic lexical units remain authoritative; graph is compiled only after reconciliation |
| Keep deterministic verification after AI generation | `verify_diff_result()` | Validate source round-trip, coverage, parents, cycles, group membership, scoring exclusions and invented IDs locally |

The implementation is clean-room: the upstream code is used to identify architectural invariants and failure classes. No Python path parser, Pydantic model, prompt body, or implementation block is copied.

## 2. Designs not suitable for direct migration

- Resume-Matcher works on a fixed Python resume object and array indices. CareerAdapt uses Resume Schema v2 IDs, branches, revisions and typed repository writes; index-based identity would be unstable.
- Its keyword gap check is mostly term presence in the tailored/master resume. CareerAdapt needs requirement-level evidence refs, source support levels, `any_of`, verification material and clarification state.
- Its post-generation refiner can regenerate a full resume. That would bypass the requested Field Patch boundary and reintroduce identity/style mutation risk.
- Its reorder salvage accepts a safe subset when the model changes list membership. V4 keeps reorder strict: the before/after multisets must be identical; additions use a separate confirmed append operation.
- Its retry guidance accepts unchanged output as a safe terminal result. CareerAdapt retries only rejected diffs once because the product must distinguish a genuine no-change result from invalid AI output.
- Its frontend response remains a reconstructed complete resume. CareerAdapt previews and applies only explicit field changes through the current revision.

## 3. Current CareerAdapt root causes

### 3.1 Premature semantic compilation

`segmentSourceUnits()` currently assigns final-like dispositions while reading lines. Fixed counters (`detailRemaining = 6`, `badcaseRemaining = 5`) absorb an arbitrary number of following lines and do not stop on same-level numbering, heading boundaries, indentation changes or blank-line structure.

### 3.2 AI acts after the lossy boundary

`analyzeJobDescriptionV3()` compiles Requirements before AI reconciliation. `reconcileJobRequirementGraphV3()` maps assignments over existing Requirements. If AI says that an existing Requirement is a heading, detail, metadata or verification material, the reconciler deliberately returns the original node and only marks it for confirmation. The wrong denominator therefore survives.

### 3.3 Ledger type is too weak

The current source unit records indentation and punctuation but lacks numbering, bullet kind, surrounding blank lines, provisional/final separation, section, relation and explicit context/group dispositions. Parent links are mutated during compilation rather than reconciled as data.

### 3.4 Validation measures the compiled result, not the reconciliation contract

The validator detects some invented references and wrappers in Requirements, but it does not enforce exactly one assignment per unit, parent existence, self-parent/cycles, allowed parent dispositions or local degradation of invalid assignments.

### 3.5 V3 graph conflates context and scoring

V3 has Requirements, groups, materials and hiring signals, but no first-class context/topic group representation. Details are attached after a Requirement already exists. This makes role mission, project directions and explanatory statements prone to entering the score denominator.

## 4. New data flow

```text
raw JD
  -> createLexicalJdUnits()
  -> buildProvisionalSemanticLedger()
  -> AI JdSemanticAssignment[] (optional)
  -> reconcileJdSemanticLedger()
  -> validateJdSemanticLedger()
  -> compileJobRequirementGraphV4()
  -> validateJobRequirementGraphV4()
  -> projectGraphV4ToLegacyRequirements()
  -> WorkspaceRepository.commitJobDraft()
```

The compiler is split into four pure layers:

1. **Lexical layer** creates stable IDs, exact text and spans. It records indentation, numbering, bullet type, punctuation and blank-line boundaries.
2. **Provisional semantic layer** uses a dynamic hierarchy stack. Frames close on same/higher numbering levels, section headings, indentation boundaries, blank-line boundaries and incompatible sibling patterns. Colon leads, example leads and topic-list leads open typed frames.
3. **Reconciliation layer** overlays AI assignments onto a copy of the provisional ledger. It never changes `id`, `text`, `sourceSpan`, `lineNumber` or lexical metadata.
4. **Compilation layer** produces scoring Requirements, details, groups, verification materials, hiring signals and context groups only from the reconciled ledger.

### Dynamic hierarchy rules

- Numbered entries produce a hierarchy level from numbering form and indentation. A new entry at the same/higher level closes the previous numbered parent.
- A colon lead opens a child frame only when the following nonblank units share a compatible indentation/bullet/sibling pattern.
- “包括但不限于 / 例如 / 比如 / 重点看 / 需包括 / 表现为” determine `groupRelation`, not a fixed child count.
- Section headings close all semantic frames.
- A large blank boundary closes weak colon/context frames unless numbering/indentation supplies stronger evidence.
- A declared count followed by a different number of sibling items creates `source_inconsistency`; the source items are never discarded or rewritten.
- Explanatory role statements remain `context`; topic directions become a context `topic_list`; neither enters the scoring denominator.

### Local degradation

Each invalid AI assignment is rejected independently. The corresponding unit keeps its provisional semantics, confidence is capped for review, and a unit-scoped issue is recorded. A transport/schema failure applies no AI overlay and keeps the complete provisional ledger.

## 5. Schema compatibility

### Persisted shape

`JobDescription.requirementGraph` accepts V3 or V4 through a discriminated union. Existing V3 records remain readable. No Dexie table or database version is added.

V4 adds:

- `JdSemanticUnit` with immutable lexical data plus `provisional` and optional `final`
- `JdSemanticAssignment`
- `JobRequirementGraphV4`
- context groups and graph issues
- graph/source coverage metadata derived from the reconciled ledger

### Adapters

- `buildCanonicalJobRequirementGraphV4(job)` returns existing V4, upgrades V3 in memory, or compiles raw text.
- `projectGraphV4ToLegacyRequirements(graph)` supplies the existing flat `JobRequirement[]` contract for current match/repository consumers.
- Existing V3 builder exports remain as deprecated adapters during this phase.
- IDs derived from source-unit IDs remain stable for equivalent source spans. Old V3 IDs are preserved when adapting an already persisted V3 graph.
- `ResumeDocument` remains derived and is not involved.

### Scoring compatibility

- Top-level scoring requirements include role mission, responsibilities, required and preferred qualifications.
- Detail units support their parent evidence but add no denominator.
- `any_of` scores once at group level; `preferred_any_of` is never hard.
- Verification materials are material checklist entries, not skill/responsibility requirements.
- Hiring signals affect narrative/summary only and are never hard constraints.
- Context/topic groups and their details are visible semantic context but do not increase the denominator.

## 6. Migration risks

| Risk | Mitigation |
| --- | --- |
| V4 reduces top-level counts and changes historical coverage percentages | Preserve V3 records; only new/reanalyzed JD uses V4 unless explicitly migrated |
| Over-eager hierarchy groups genuine sibling duties as details | Close frames on same-level numbering/heading/indentation; expose low-confidence items as reviewable |
| AI supplies partial/duplicate/invented IDs | Per-unit validation and provisional fallback; never discard the whole JD |
| Parent cycles or invalid parent types | Detect before compilation; reject only involved parent overrides |
| Source text normalization breaks round-trip | Calculate spans from the raw string and assert `rawText.slice(start,end) === text` |
| Context groups are accidentally projected into legacy Requirements | One centralized projection with explicit disposition allow-list |
| Existing UI assumes V3 fields | V4 adapter exposes the existing canonical read model until UI migration is complete |
| Graph persistence makes records larger | Compact lexical metadata; AI assignments are not duplicated as full source text |
| Inconsistent declared counts block save | Record `source_inconsistency`, set `needs_review`, but allow repository commit |

## Acceptance fixtures

The AI trainer fixture must compile approximately 3 top-level responsibilities, one topic-list context group with 3 details, and a `source_inconsistency` issue for “two” versus three listed directions.

The Coding Agent fixture must preserve 7 top-level responsibilities, one 4-item `any_of` group, 6 preferred items, 6 verification materials and 3 hiring signals. Scenario/task-package/reward-hacking lines remain details and do not increase the denominator.
