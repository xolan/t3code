# Tasks: Fix Thread Continuation

**Input**: Design documents from `/specs/001-fix-thread-continuation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No project setup needed — this is a bug fix in an existing codebase. No new files, packages, or schemas required.

**Checkpoint**: Existing codebase ready for modification.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core changes that enable session recovery for all user stories.

**CRITICAL**: US1 and US2 both depend on session teardown and recovery infrastructure.

- [ ] T001 Make `stopSession` in Claude Code adapter handle error-state sessions gracefully (cancel pending approvals, remove from sessions map, emit session.exited event even if query.close() fails) in `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`
- [ ] T002 Add teardown-before-recovery logic in `recoverSessionForThread`: when adapter reports an existing session (hasSession=true) but binding status is "error", call `adapter.stopSession(threadId)` before calling `adapter.startSession()` in `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] T003 Add a per-thread recovery mutex/semaphore in `ProviderCommandReactor` to prevent concurrent recovery+turn-start attempts for the same threadId in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

**Checkpoint**: Foundation ready — recovery infrastructure in place for all user stories.

---

## Phase 3: User Story 1 - Continue Thread After Error State (Priority: P1) MVP

**Goal**: When a thread's session is in error state, sending a new message triggers automatic recovery (teardown → fresh session → turn dispatch) instead of crashing.

**Independent Test**: Force a thread into error state (kill provider mid-turn), send a new message, verify thread continues.

### Implementation for User Story 1

- [ ] T004 [US1] Update `ensureSessionForThread` in ProviderCommandReactor to detect when the current session is in error state and trigger session teardown+restart via ProviderService instead of attempting to send a turn to the dead session in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] T005 [US1] Ensure `recoverSessionForThread` in ProviderService preserves the `resumeCursor` from the errored session's binding when starting the fresh session, so the provider can resume conversation context in `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] T006 [US1] Emit proper domain events during recovery: session-set with status="starting" when teardown begins, then status="ready" when fresh session is established, so the UI reflects the recovery lifecycle in `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] T007 [US1] Add recovery timeout: if `recoverSessionForThread` (teardown + startSession) exceeds 10 seconds, fail with a typed error and emit session-set with status="error" and descriptive lastError in `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] T008 [US1] Verify that `lastError` is cleared from the session state once recovery succeeds and a new turn starts (the fresh session's session-set event should have lastError=null) in `apps/server/src/provider/Layers/ProviderService.ts`

**Checkpoint**: Error-state threads are recoverable by sending a new message. Server does not crash.

---

## Phase 4: User Story 2 - Continue Thread After Interrupted Turn (Priority: P1)

**Goal**: When a turn interrupt fails or leaves a stale running state, the next message detects this and recovers.

**Independent Test**: Start a turn, request interrupt (which fails), send follow-up message, verify it succeeds.

### Implementation for User Story 2

- [ ] T009 [US2] Update `ensureSessionForThread` in ProviderCommandReactor to detect stale running state: if the orchestration read model shows session status="running" with an activeTurnId, but the adapter reports no active turn (or session is in error/closed), treat it as a stale session needing recovery in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] T010 [US2] Handle the case where `interruptTurn` fails and leaves session in a state where the adapter's session exists but status is "error": the subsequent turn-start should trigger the same recovery path as US1 (teardown → fresh session → turn) in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

**Checkpoint**: Failed interrupts no longer leave threads permanently stuck. Users can always continue.

---

## Phase 5: User Story 3 - Server Stability Under Session Failures (Priority: P2)

**Goal**: A single broken provider session never crashes the server process.

**Independent Test**: Trigger multiple concurrent session failures, verify server stays up and other threads work.

### Implementation for User Story 3

- [ ] T011 [P] [US3] Wrap the fire-and-forget async SDK stream consumer IIFE (lines ~796-836) in an outer try/catch so that any synchronous throw before the inner try block is caught, transitions the session to error state, and emits session.exited instead of producing an unhandled rejection in `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`
- [ ] T012 [P] [US3] Add a global `process.on('unhandledRejection')` handler in server startup as defense-in-depth: log the error with full context but do not crash the process in `apps/server/src/main.ts`

**Checkpoint**: Server remains stable under any combination of provider session failures.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation, edge cases, and quality gates.

- [ ] T013 Verify edge case: rapid messages to an errored thread are serialized by the per-thread mutex (T003) — second request waits for first recovery to complete, does not spawn a parallel recovery attempt. Manual test or unit test in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] T014 Run `bun typecheck` and `bun lint` to ensure all changes pass quality gates
- [ ] T015 Run `bun run test` to ensure no existing tests are broken

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No work needed — existing codebase
- **Foundational (Phase 2)**: T001, T002, T003 must complete before user stories. T001 and T002 can run in parallel (different files). T003 is in a different file and can also run in parallel.
- **User Story 1 (Phase 3)**: Depends on T001, T002, T003. Tasks T004-T008 are sequential (same files, dependent logic).
- **User Story 2 (Phase 4)**: Depends on T001, T002, T003. Can run in parallel with US1 but shares `ProviderCommandReactor.ts` so sequential is safer.
- **User Story 3 (Phase 5)**: T011 and T012 are independent of each other and of US1/US2 (different files). Can run in parallel with any phase.
- **Polish (Phase 6)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational (Phase 2). No dependencies on other stories.
- **User Story 2 (P1)**: Depends on Foundational (Phase 2). Shares recovery infrastructure with US1 but is independently testable.
- **User Story 3 (P2)**: No dependencies on US1 or US2. Can be implemented at any time.

### Within Each User Story

- Core recovery logic before event emission
- Event emission before timeout handling
- All implementation before validation

### Parallel Opportunities

```text
# Phase 2 — all three foundational tasks touch different files:
T001 (ClaudeCodeAdapter.ts) || T002 (ProviderService.ts) || T003 (ProviderCommandReactor.ts)

# Phase 5 — both tasks touch different files:
T011 (ClaudeCodeAdapter.ts) || T012 (main.ts)

# Cross-phase — US3 can run alongside US1/US2:
(T004-T008) || (T011, T012)
```

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tasks together (different files):
Task T001: "Harden stopSession for error-state in ClaudeCodeAdapter.ts"
Task T002: "Add teardown-before-recovery in ProviderService.ts"
Task T003: "Add per-thread recovery mutex in ProviderCommandReactor.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T003) — all parallelizable
2. Complete Phase 3: User Story 1 (T004-T008) — sequential
3. **STOP and VALIDATE**: Force a thread into error state, send a message, verify recovery
4. Run quality gates (T014, T015)

### Incremental Delivery

1. Foundational (T001-T003) → Recovery infrastructure ready
2. User Story 1 (T004-T008) → Error-state recovery works → **MVP**
3. User Story 2 (T009-T010) → Stale interrupt recovery works
4. User Story 3 (T011-T012) → Server hardened against crashes
5. Polish (T013-T015) → Edge cases verified, quality gates pass

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No new files or schemas needed — all changes are in existing files
- All changes scoped to `apps/server/src/`
- Commit after each phase for clean rollback boundaries
