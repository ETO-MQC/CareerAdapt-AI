# COMP-01 — Hermes-inspired Agent Workspace UX

2026-11-02. **Implementation delivered; W5 PARTIAL.** One pre-existing simulated workflow assertion remains failed. This is not an all-green release gate.

## Scope, baseline and exclusions

Repository ETO-MQC/CareerAdapt-AI. Frozen baseline `d80593315a3b01aa217402809ae927b96dfed2a4` (P5.1.8-B R2 COMPLETE) verified using successful fetch, cat-file, show, log, branch/worktree inventories. Created `competition/5.1.8` directly from that commit in `E:/DEF/CareerAdapt-competition-5.1.8`. main started at `5e86e6f` with unrelated uncommitted SQLite work; retained unchanged. No 5.2.1 commits merged/cherry-picked.

Read the supplied rules/current handoff, P5.1.8-B/R2 report and related production code/tests. P5.2.0 A/B reports on main consulted only to exclude Desktop/persistence migration. No separately named P5.2.0 audit report was found. `AgentActivityGroup` is internal to AgentConversation, not a separate file. Applied careeradapt-ui-quality in system-led improvement mode; Hermes supplies interaction patterns, not visual styling.

Only right-hand AI workspace presentation and its tests changed. Host, Runtime, BridgeTransport, Repository, domain/schema/guards, AppShell/sidebar/navigation, import/editor pages, PDF core, runtime lock and production dependencies are unchanged. No real Provider requests or user data; no installer or subsequent stage.

## Original architecture and audit

AgentWorkspace subscribes to existing Host and Runtime external stores. AgentWorkspaceLayout owns task header/service controls. AgentConversation owns Markdown, turn grouping, inline questions/confirmations and actions. Composer uses session-owned AgentAttachmentStore. AgentArtifactDrawer owns business result views. AgentRuntimeProvider owns Run interaction; Host/Repository own durable messages, branch semantics, confirmation and writes. Durable transcript, active conversation view and model context remain distinct.

| Capability | Baseline finding | Final status and evidence |
| --- | --- | --- |
| Messages | Existing timeline/actions | PASS: existing browser journey, structure tests; preserved |
| Streaming | Existing Host deltas | PASS: isolated browser and real Hermes A/G/M/I |
| Attachments | Existing durable session ownership, preview/remove/drop | PASS: metadata enhanced; new browser reload/preview/removal test; real M material flow |
| Tool activity | Existing grouping hid a turn with tools but no assistant message | PASS: fixed orphan grouping/current step; unit and real Hermes receipts |
| User questions | Existing typed options/checkpoints/free text | PASS: preserved; typed choice test and real M workflow |
| Business confirmation | Existing real inline card and continuation | PASS: preserved; real I writes Job once; M confirmed isolated branch/PDF |
| Generic upstream tool approval | Hermes waiting_for_approval exists | PARTIAL: label/unit mapping; no new unsupported approval buttons or upstream approval certification |
| Run Stop | Composer called pause-like state.interrupt | PASS: routes through existing Provider interruptRun; pending Stop + no residual indicators; real delayed fixture |
| Run recovery | Existing same-Run reattach/terminal reconciliation | PASS: short delayed fixture reload/completion/cancel/next-run; durable recovery tests |
| Message edit | Existing modern branch isolation and legacy revision compatibility | PASS: preserved; branch tests and edit browser; new read-only historical branch browser |
| Regenerate | Existing original user/checkpoint/context binding | PASS: existing targeted browser and unit isolation/single-flight |
| History | Existing complete transcript; header could use stale list; no full old-branch view | PASS: refreshed list/live current snapshot + read-only branch view; 65-message Repository test |
| Artifacts | Existing launcher/drawer/business actions | PASS: retained; real M and 1024 overlay/close/reopen/Escape |
| Legacy simulated checkpoint journey | Fixture returned terminal before tool events | PARTIAL: baseline reproduced failure; fixture contract corrected; later /resume busy-label assertion still fails |

PASS is bounded to the cited executed scenarios, not every possible Provider or long-duration failure.

## Interaction reconstruction and components

- Header: compact title and career context; service health separate from task lifecycle. History has one primary entry. Conversation/technical exports remain available in More. Existing advanced runtime controls remain in their popover.
- Timeline: tool activities belong to the assistant turn, including tool-only turns before first assistant text. Current step stays visible; completed details stay compact and preserve explicit disclosure preference. No raw tool arguments/results or private reasoning added.
- Markdown: render/copy/reference original message content. Do not strip English prose or blank lines in code. Existing renderer escapes HTML, rejects unsafe link protocols and supports headings, lists, quotes, tables, code and links. Legacy language normalization remains for error presentation/compatibility only.
- Reading: new deltas follow latest only while the reader is near the end; a jump control restores following. No formal messages are sliced or deleted.
- Composer: material/tools in one plus menu; every original action retained. Enter sends, Shift+Enter inserts newline, IME confirmation does not send. Existing resize/drop/queue behavior retained. Attachments show name/type/size/state; failed files remain retryable/removable; preview read failure is explicit.
- Questions/confirmation: use existing typed actions, checkpoint placeholders, inline choices and real confirmation boundary. No new task/Host/Planner created to continue an answer.
- Stop: immediate request-pending presentation, existing Provider Run stop, existing authoritative reconciliation/cancellation fencing. No service shutdown for ordinary Stop. Cancelled-turn UI removes thinking/tool spinners; partial streamed text is marked unfinished. Durable source messages are unchanged.
- History: list refresh uses existing history-open event. Current live snapshot prevents stale branch options. Read-only historical branch projection never selects a task, invokes a tool or changes model context. Tool/system payloads are excluded. Legacy flat sessions retain existing message revisions; no synthetic branch migration.
- Responsive artifacts: existing overlay breakpoint extended to <=1100px, including stored split preference. Focus trap/Escape refresh on split/overlay changes. 1024px conversation is not squeezed by a 520px split panel. Sidebar source and dimensions unchanged.

Flow: input/material -> existing Host/Run -> grouped tool activity/stream -> typed question or confirmation -> existing continuation -> result/Artifact. Stop and history inspection act on the existing task without starting another Run.

## Read-only run state mapping

`agentRunPresentation` derives labels from the existing Host status, same-turn Hermes handle and service status. It owns no transitions, persistence or execution. Local stoppingSessionId is only a pending UI request flag.

| Input | Task label |
| --- | --- |
| idle / service unavailable | AI 就绪 / Agent 不可用 |
| queued / running | 等待执行 / 正在处理 |
| waiting_for_user | 等待你回答 |
| waiting_for_approval | 等待授权 |
| pending confirmation | 等待确认 |
| paused / stopping | 已暂停 / 正在停止 |
| completed / failed / cancelled | 已完成 / 执行失败 / 已停止 |

Service loss does not turn an already completed task into a running/failed task. Stale prior-turn handles do not override a new turn. No extra lifecycle or fictional pause/resume capability introduced.

## Executed verification

| Command / selection | Result | Local evidence |
| --- | --- | --- |
| pnpm typecheck (baseline) | exit 0 | initial tool output |
| baseline Vitest structure/edit/terminal | 3 files, 31 PASS | initial tool output |
| pnpm exec vitest run (14 named related files) | 138 PASS, 0 failed | .tmp/comp01-unit-delivery.log |
| pnpm lint | exit 0, full repository | .tmp/comp01-lint-delivery.log |
| pnpm typecheck (delivery, restored Next config) | exit 0 | .tmp/comp01-typecheck-delivery.log |
| pnpm build (isolated .tmp output) | exit 0 | .tmp/comp01-build-delivered.log |
| isolated normal Chinese conversation browser | 1 PASS | before/after screenshots; direct output |
| existing picker/navigation/edit/regenerate selection | picker/navigation/regenerate PASS; edit passed separately after new status assertion | .tmp/comp01-existing-journeys.log; .tmp/comp01-ui-matrix.log |
| node scripts/hermes-integration.mjs integration --grep 'CASE [AGIM]' | 4 PASS, 22 local fake calls | .tmp/comp01-hermetic-targeted.log |
| node scripts/hermes-integration.mjs integration --grep 'CASE M Core-02' (artifact extension) | 1 PASS, 16 fake calls; official PDF + real overlay | .tmp/comp01-real-artifact2.log |
| P518B_PREFLIGHT=1 node scripts/hermes-integration.mjs slow-provider | 1 PASS, 3 fake calls; reload same Run, cancelled late response, no business writes, next Run isolation, no live indicators after cancel | .tmp/comp01-stop-final.log |
| new theme/viewport browser | PASS: 1440x900 and 1024x768 x light/dark x green/burgundy; no horizontal overflow, menu/input reachable, sidebar width stable, export download | .tmp/comp01-visual-final.log |
| new attachment browser | PASS: durable metadata, refresh, preview, remove, no removed file in submitted message | .tmp/comp01-ui-final.log |
| new branch-history browser | PASS: old question/answer readable, current branch unchanged, 0 additional Run starts, Escape closes | .tmp/comp01-history-ui3.log |
| git diff --check | exit 0 | final Git check |

The 14 test files are listed in competition-01-agent-workspace-ux-evidence.json. New file contributes 27 tests. The 65-message test saves twice, saves a narrowed message snapshot, reopens Repository and verifies all original IDs/counts and zero Profile/Resume/Job writes. Related durable-artifact tests verify receipt-based crash recovery without duplicate branches; terminal tests reject late high-revision snapshots.

Golden journeys: J1/J3 PASS (normal/real Hermes); J2 PASS (new attachment + real M); J4/J5 PASS (typed choices/real M/I); J6/J8 PASS (short delayed run); J7 PASS (edit/regenerate/branch inspection + isolation tests); J9 PASS (real artifact/PDF); J10 PASS (8 combinations + real overlay). The old simulated checkpoint test is an additional unresolved regression, so W5 remains PARTIAL. Full 30/60/180s slow-provider mode was not rerun; preflight uses 1/2/3s running checkpoints and an 8s delayed first response. Historical 180s evidence is not relabeled as current.

## Failures retained and limits

1. Initial Playwright grep selected zero tests; corrected selector ran. A first pass reused pre-existing port 3000 and is excluded from competition acceptance; branch checks use isolated port 3029 or the hermetic launcher.
2. Webpack dev failed on baseline client node:crypto import. Normal Turbopack used. The shared node_modules junction requires local-only root E:/DEF; that temporary config and generated Next config files are restored byte-for-byte before delivery. Generated .next-comp01 was accidentally scanned by lint; moved intact to ignored .tmp/comp01-webpack, then full lint passed. No bulk deletion or ignore-rule change.
3. Setup readiness, preview close-label, new-task-ready and modal-already-open test errors were corrected with actual UI predicates, without removing product assertions. Original diagnostic logs retained locally.
4. Simulated checkpoint journey failed on frozen source too: run_status claimed completed before emitting tool events. Fixture now stays running until event delivery. This restores the checkpoint; the test then fails at /resume expecting 正在处理 while it is awaiting a Job. Kept original assertion and stopped bounded attempts. No unrelated /resume or Host changes. **Unresolved, not PASS.**
5. History inspection exposed header stale-list behavior; refreshed and merged live snapshot. New browser waits for the second Run instead of matching a prior completed frame. History dialog made focusable for real Escape handling. Final attempt PASS; prior failures retained.
6. Synthetic screenshot fixtures do not advertise real local service readiness: browser-only screenshots can show unavailable service while replayed task is completed. Real Hermes integration readiness and actions were checked separately. This does not assert arbitrary upstream approval or real-provider production latency.

No claim that every possible recovery avoids permanent loading; tested bounded scenarios have no duplicate user message/start, no permanently running indicator and no duplicate formal write. No real credentials, logs, resume data or private reasoning included in committed evidence. Raw local hermetic logs may contain ephemeral test bridge tokens and are intentionally not committed.

## Screenshots and visual correction

Inspected before/after at both required sizes. Removed duplicate toolbar/history actions and excess composer shortcuts; shortened service label; corrected 1024 artifact geometry and historical-dialog padding after screenshots. Eight combination screenshots remain local artifacts/. Selected synthetic evidence committed:

- [Before 1440](evidence/comp01-before-1440.png)
- [After 1440 light green](evidence/comp01-after-1440-light-green.png)
- [After 1024 light burgundy](evidence/comp01-after-1024-light-burgundy.png)
- [After 1024 dark green](evidence/comp01-after-1024-dark-green.png)
- [Real synthetic artifact 1024](evidence/comp01-real-artifact-1024.png)
- [Read-only historical branch](evidence/comp01-branch-history.png) (captured before the final 16px inner padding correction)

## Git and next step

Audit commit 78dfda5; UI commit 243de04; regression commit 96bd2c8. Final evidence/report commit and push identity are recorded in the local plan/history and final response (a document cannot embed its own commit hash). Only competition branch is published for review; no merge into main. plan4/history4 remain ignored local handoff documents in this worktree; main's copies remain unchanged.

**Remaining work:** review COMP-01 and independently reconcile the old simulated /resume busy-state assertion with the waiting-for-Job contract. W5 is PARTIAL until resolved. No automatic next phase, release certification, runtime migration, Skills Quality or installer work.
