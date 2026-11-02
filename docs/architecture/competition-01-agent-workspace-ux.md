# COMP-01 — Agent Workspace UX

Date: 2026-11-02. Status: IN PROGRESS / NOT ACCEPTED.

## Scope and Git isolation

Only right-hand AI workspace on competition/5.1.8, worktree E:/DEF/CareerAdapt-competition-5.1.8. Frozen baseline d80593315a3b01aa217402809ae927b96dfed2a4 verified by cat-file, show, log and worktree inventory after successful fetch. main has unrelated uncommitted SQLite work; untouched. No Desktop Plugin, persistence port, runtime upgrade, new planner, schema or dependency. P5.1.8-B R2 COMPLETE report reviewed; P5.2.0 A/B reports on main consulted only to exclude migration work. No separately named P5.2.0 audit report found.

## Original architecture and audit

AgentWorkspace subscribes to existing Host and Runtime external stores. AgentWorkspaceLayout owns header/runtime controls. AgentConversation owns messages, Markdown, inline choices, confirmation and an internal AgentActivityGroup (not a separate file). Composer stages session-owned attachments; ArtifactDrawer owns results. AgentRuntimeProvider owns Hermes interaction; Host/Repository own history, branches and confirmation. Durable transcript, activeBranchMessages and model context are distinct. Existing terminal reconciliation must remain intact.

| Capability | Existing implementation | Current acceptance | COMP-01 treatment |
| --- | --- | --- | --- |
| Messages | Timeline + message actions | PARTIAL: baseline component tests | Preserve, improve hierarchy |
| Streaming | Host deltas + streaming row | PARTIAL: baseline browser against shared server excluded from branch acceptance | Verify isolated server |
| Attachments | Session-owned durable store, remove, preview, drop | PARTIAL: source inspected | Expose type/size/status, retain errors |
| Tool activity | Turn grouping + persisted disclosure | OPEN: activity-only turns disappear | Fix grouping; current step visible |
| Questions | Options/checkpoints and free text | PARTIAL: source inspected | Preserve real action routing |
| Confirmation | Inline card, real Host continuation | PARTIAL: source inspected | Preserve boundary, verify |
| Stop | Composer calls state.interrupt directly | OPEN: pause-style entry rather than provider run stop | Route through existing host.interruptRun |
| Recovery | Reattach, status reconciliation, safe failures | PARTIAL: baseline terminal tests | Preserve; targeted browser |
| Editing | active branches and parent context | PARTIAL: baseline editing tests | Preserve; browser regression |
| Regenerate | original user and branch semantics | PARTIAL: source inspected | Preserve; browser regression |
| History | Repository transcript + history dialog | PARTIAL: source inspected | Preserve; long history tests |
| Artifact | Existing launcher/drawer/business actions | PARTIAL: source inspected | Preserve; narrow viewport check |

PASS requires executed evidence; source review alone is PARTIAL. Historical reports do not count as current execution.

## Interaction model borrowed

One compact task header, separate service and task states, assistant-turn tool receipts, visible current step, quiet completed disclosure, inline questions/confirmation, one attachment/tool menu, persistent composer, explicit Stop and recovery. Use CareerAdapt tokens and shared components; do not copy Hermes styling or private reasoning.

## Initial evidence

pnpm typecheck exit 0. Three files agentConversationStructure / agentMessageEditing / hermesTerminalReconciliation: 31/31 PASS. First Playwright grep selected no tests (exit 1); corrected selector passed against pre-existing port 3000, excluded as branch evidence. Dedicated webpack dev server now uses port 3028 / .next-comp01. Baseline screenshots and implementation acceptance pending. No real provider requests.

## Planned changes

Presentation-only run-state projection from existing Host/session/service snapshots; no second lifecycle. Composer Stop calls existing provider interruptRun, with local request-pending presentation until it settles. Existing cancellation fencing retained. Merge exports into header menu, preserve workflow pause action and artifacts. Preserve original Markdown source at rendering/copy boundaries. Keep incomplete activity turns visible and grouped by turn. Protect IME Enter and consolidate composer shortcuts without deleting them.

## Remaining acceptance

W1-W5 implementation, isolated screenshots at 1440x900 and 1024x768, related unit/integration, golden journeys, lint/typecheck/build and final diff. No completion or push claim yet. Installer, real-provider quality, 5.2.1 and all subsequent stages excluded.
