# Codex Agent Interaction Reference for CareerAdapt AI

Status: P4.5 final interaction rebase reference, 2026-08-22

This document is the implementation boundary for the P4.5 interaction
runtime. CareerAdapt adapts the ownership and protocol semantics of the
current OpenAI Codex implementation; it does not introduce a second,
CareerAdapt-specific chat lifecycle.

## Reference files reviewed

The following files were reviewed from the current `openai/codex` `main`
branch before implementation:

- [`app-server/README.md`](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [`tui/src/app_command.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_command.rs)
- [`tui/src/chatwidget/input_queue.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/input_queue.rs)
- [`tui/src/chatwidget/input_flow.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/input_flow.rs)
- [`tui/src/chatwidget/input_submission.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/input_submission.rs)
- [`tui/src/chatwidget/turn_runtime.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/turn_runtime.rs)
- [`tui/src/chatwidget/interrupts.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/interrupts.rs)
- [`tui/src/chatwidget/streaming.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/streaming.rs)
- [`tui/src/bottom_pane/request_user_input/mod.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/request_user_input/mod.rs)

The app-server README establishes the public conceptual model: a thread owns
turns, a turn owns streamed items, and thread fork is the branch operation.
The TUI files establish the client-side ownership rules: a pending-start lock,
an input queue, separate user-turn and user-input-answer commands, one
interrupt/request-input owner, and transient streaming state that is
finalized into history.

## Concept mapping

| Codex concept | Codex source file / behavior | CareerAdapt equivalent | Reuse or adaptation decision |
| --- | --- | --- | --- |
| Thread | `app-server/README.md`: thread contains turns and can be forked | `AgentSession` plus its immutable message/checkpoint history | Reuse the existing session as the thread. Do not add a parallel conversation entity. Branch metadata remains session-owned. |
| Turn | `app-server/README.md`, `app_command.rs`: `UserTurn` creates one semantic turn | `AgentTurn` and one `TurnController` operation | Reuse `AgentTurn`. A composer request, retry, or workflow continuation must not manufacture extra turns for button clicks. |
| Item | `app-server/README.md`: turn items; `streaming.rs`: completed items become authoritative history | `AgentMessage` and durable workflow/artifact items | Reuse messages/checkpoints as items. Tool progress and interaction prompts are items of the owning turn, not turns themselves. |
| `UserTurn` | `app_command.rs`: distinct user-turn command | Normal free-form composer submission through `AgentHostStore.runUserEvent` | Adapt to the existing Router/Hermes entry point only for semantic user text. The controller owns its single-flight and queue behavior. |
| `UserInputAnswer` | `app_command.rs`: answer carries request ID and response separately from `UserTurn` | `WorkflowInteractionController` / `consumeWorkflowInteraction` and tailoring answer receipts | Reuse the deterministic domain path. A known interaction answer never enters the global Router and never starts Hermes. |
| `Interrupt` | `app_command.rs`, `interrupts.rs`, `turn_runtime.rs` | `TurnController.interrupt` plus Hermes cancellation and pending-start cancellation | Adapt abort semantics to browser `AbortController` and Hermes run cancellation while preserving committed repository state. |
| Pending user turn start | `input_queue.rs`: `user_turn_pending_start`; `input_submission.rs`: set before the async start; `turn_runtime.rs`: clear when the task starts or fails | `TurnController` pending-start state and operation receipt | Reuse the ordering exactly: claim the operation synchronously before any network request. A second request reuses/queues; it cannot call `run_start` again. |
| User input queue | `input_queue.rs` and `input_flow.rs`: queue independently, send one when idle | `TurnController` queue for normal user text/steer requests | Reuse the ownership rule. Workflow answers use the interaction queue instead and are not converted into queued user turns. |
| Request-user-input queue | `interrupts.rs`: protected prompts are queued FIFO; request-input UI owns one active request | `WorkflowInteractionController` and persisted `WorkflowInteraction` | Reuse one active protected interaction, resolve by interaction/request ID once, then expose the next. Generic Composer state does not own this transition. |
| Answer commit | `request_user_input/mod.rs`: per-question committed flag; one answer event; final question completes request | `interactionId + revision` submission operation and `TailoringQuestionAnswerReceipt` | Adapt the commit to a repository transaction and the CareerAdapt receipt schema. Repeated clicks reuse the operation and cannot create duplicate receipts. |
| Turn runtime | `turn_runtime.rs`: starts one task, clears pending-start, finalizes/cleans up and drains one queue item | `TurnController` around `AgentHostStore.startTurn` and `HermesCareerAgentRuntime` | Consolidate pending/running/interrupting/terminal ownership in the controller. Existing executor helpers are not a second lifecycle. |
| Streaming tail | `streaming.rs`: transient tail; completed item/history is authoritative | `StreamingProjection` / runtime event projection versus persisted `AgentMessage` | Reuse the preview-only rule. Stream completion may finalize an assistant item, but may not delete, hide, re-parent, or recreate a durable `WorkflowInteraction`. |
| Progress/tool activity | `turn_runtime.rs`, `streaming.rs`: events belong to the active turn | `AgentProgressTimeline` and tool/activity items | Reuse item ownership. Progress updates may change data/counts only; they cannot remount the controller or alter Task Steps disclosure. |
| Retry | Codex turn/task restart and checkpointed runtime behavior | `retryCurrentWorkflowStep` from the committed workflow checkpoint | Adapt for the Career workflow: retry repeats the failed operation from its checkpoint, preserves resolved receipts and immutable prefix, and starts at the first failed stage. It is not regeneration. |
| Regenerate / fork | `app-server/README.md`: `thread/fork`; TUI turn/message replacement semantics | `prepareSessionForAssistantRegeneration`, `ConversationBranch`, target assistant message | Reuse fork/branch semantics. The request must carry target assistant message, target turn, parent user message, and base checkpoint/version. It must not append a fake retry user message. |
| One active turn | `input_flow.rs`: pending-or-running guard; `turn_runtime.rs`: one runtime task | `TurnController` state: `idle`, `pending_start`, `running`, `waiting_for_user`, `interrupting`, `completed`, `failed` | One authoritative controller per session. UI debounce is optional polish only; correctness is the synchronous controller claim. |
| App-server lifecycle | `app-server/README.md`: `turn/start`, `turn/interrupt`, queue/steer, fork | `HermesCareerAgentRuntime` transport commands behind `TurnController` | Reuse Hermes as semantic runtime, but keep lifecycle decisions in the controller. The domain Driver remains the stage machine and never owns turn start/interrupt. |

## CareerAdapt-specific deviations

These are domain boundaries, not alternate interaction lifecycles:

1. A tailoring answer is deterministic and already typed by the user. It is
   therefore a `UserInputAnswer` equivalent and is committed through the
   repository; invoking Hermes just to classify `有 / 没有 / 不确定 / 跳过`
   would add semantic work that Codex does not require for a known request.
2. A tailoring interaction has a durable `questionPlanId` and `questionId`.
   `questionPlanRevision` remains optimistic-concurrency/provenance metadata;
   it is never an answer-identity filter. This is required by the Career
   receipt model and prevents an earlier resolved question from becoming
   unresolved when later questions advance the plan revision.
3. A successful Career workflow has stronger completion gates than a chat
   turn: Fact Guard, `CareerResumeQualityPolicyV1`, `CompletionGuard`, atomic
   `ResumeBranch` / `ResumeRevision` writes, and repository read-back. These
   are domain completion conditions inside the Driver, not extra turn owners.
4. The browser UI shows immediate synchronous pending feedback for an option
   click. This is a projection of the controller's already-claimed operation;
   it does not create a UI-owned lifecycle.

## Current incident boundary

The incident is now reproduced and its first business failure is proven. The
pre-rebase path was:

`AgentHostStore.consumeWorkflowInteractionOnce` → local answer/session
mutation → `advanceTailoringWorkflow` → `generate_tailoring_changes` →
`generateTailoringDiffsCommand`, with the Driver receiving `current` before
the answer write had been committed/read back.

Exact pre-fix location and predicate:

- `src/agent/runtime/AgentHostStore.ts`,
  `consumeWorkflowInteractionOnce()`: after
  `consumeTailoringQuestionAnswerLocally()`, it called
  `advanceTailoringWorkflow({ taskState: current.taskState,
  tailoringSession: current.taskState.knownSlots.tailoringSession })` before
  `persistence.save(current)` and before a canonical `persistence.get()`.
- `src/services/jobs/tailoringCommands.ts`,
  `generateTailoringDiffsCommand()`: the guard observed
  `parsed.session.plan.questionPlan.status === "asking"` and returned the
  exact code `tailoring_questions_incomplete`.

The regression fixture makes `save()` persist the new Q3 state but return the
old object. The Driver now observes the canonical read instead. With Q1/Q2/Q3
receipts at revisions 1/2/3, the canonical snapshot is:

```text
questionPlan.id = p45c1-race-question-plan
questionPlan.revision = 4
questionPlan.status = ready_for_generation
questionPlan.activeQuestionId = undefined
answerReceipts = q-1@1, q-2@2, q-3@3
clarificationComplete = true
taskState.stage = generate_changes
```

The revision-comparison hypothesis is disproven as the source of this
incident. Receipt completeness is keyed by `(questionPlanId, questionId)`;
`questionPlanRevision` is retained as provenance and is not compared to the
latest plan revision. The old failure was the stale pre-Q3 Driver snapshot,
not invalidation of the historical Q1/Q2 receipts.

The corrected protocol is:

`consume answer → atomic receipt/plan commit → canonical session/plan read →
advanceTailoringWorkflow(updated state)`.

The hard completeness predicate also requires exactly one terminal receipt
for every required question ID; it ignores plan revision and rejects missing
or duplicate identities.

## Ownership invariant after the rebase

`Hermes` is semantic intelligence; `TurnController` owns one active/pending
turn, queues, interrupt, retry, and regenerate; `WorkflowInteractionController`
owns request/answer submission; `TailoringWorkflowDriver` owns business stage
progression; `Transcript` owns immutable committed items;
`StreamingProjection` owns transient preview; `WorkspaceRepository` owns
durable Career state; and UI components project state with immediate feedback.

Any new code that cannot be mapped to one of these Codex-equivalent owners is
out of scope for P4.5.
