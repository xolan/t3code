# Research: Fix Thread Continuation

## R-001: Root Cause of "ProcessTransport is not ready for writing" Crash

**Decision**: The crash occurs because `sendTurn` attempts to call `ctx.pushPrompt()` on a Claude Code session whose underlying SDK `ProcessTransport` has already exited. The error is thrown synchronously from the SDK and, prior to commit 9918fdea, was not caught — propagating as an unhandled exception that crashes the server.

**Rationale**: The error log shows the sequence: (1) turn-interrupt-requested → (2) session-set with status="error" and lastError="Turn interrupt failed after session recovery" → (3) user sends new message → (4) turn-start-requested → (5) `pushPrompt` throws "ProcessTransport is not ready for writing" → server crash. The session was in error state but the turn-start flow did not check session health before dispatching to the provider.

**Alternatives considered**:
- Reconnecting to the same SDK process: Not possible — the SDK process has exited.
- Catching the error at the WebSocket layer: Too late — the crash happens inside the provider command reactor's async processing, not in the request handler.

## R-002: Session Recovery Architecture

**Decision**: When a turn is requested on a thread with an errored/stale session, the system must: (1) detect the broken state, (2) tear down the old session, (3) start a fresh provider session (with resumeCursor if available), (4) then dispatch the turn.

**Rationale**: The existing `resolveRoutableSession` in `ProviderService.ts` (line 306) already supports recovery with `recovery: true`, which calls `recoverSessionForThread`. However, recovery currently fails when the session is in error state because `requireSession` in the Claude Code adapter rejects error-state sessions (commit 9918fdea made error ≡ closed). The gap is: recovery needs to explicitly stop/teardown the errored session before starting a new one.

**Alternatives considered**:
- Auto-recovery on any error event: Too aggressive — some errors may be transient and self-resolve.
- Requiring user to manually create a new thread: Poor UX, violates spec requirement SC-001.

## R-003: Preventing Concurrent Recovery Attempts

**Decision**: Use the existing orchestration command queue (single-worker serialized processing in `OrchestrationEngine`) combined with a per-thread recovery lock in `ProviderCommandReactor`.

**Rationale**: The orchestration engine already serializes commands through an unbounded queue with a single worker. However, provider operations (startSession, sendTurn) happen outside this queue in the reactor. A per-thread mutex/semaphore in the reactor prevents overlapping recovery+turn-start attempts for the same thread.

**Alternatives considered**:
- Deduplication cache only: Already exists (30min TTL) but keyed by command, not by thread recovery state — insufficient for rapid re-sends.
- Queueing at the WebSocket layer: Would block unrelated operations.

## R-004: Session Teardown Before Recovery

**Decision**: Before starting a fresh session, explicitly call `adapter.stopSession(threadId)` (which sets status to "closed" and cleans up resources), then remove the session from the in-memory map. This ensures the adapter's `startSession` validation (which rejects duplicate active sessions) passes.

**Rationale**: The Claude Code adapter's `startSession` checks for existing sessions and fails if one exists (line 614+). Simply marking a session as "error" doesn't remove it from the sessions map. Explicit teardown is needed.

**Alternatives considered**:
- Overwriting the session in-place: Would leak the old SDK query object and its async stream consumer.
- Adding a "replace" mode to startSession: Increases adapter complexity; teardown+create is simpler and more explicit.

## R-005: Fire-and-Forget Async Stream Vulnerability

**Decision**: The SDK stream consumer in `ClaudeCodeAdapter.ts` (lines 796-836) runs as a fire-and-forget async IIFE. Errors within the try block are caught, but a synchronous throw before entering the loop (e.g., SDK initialization failure) could produce an unhandled rejection. Wrap the entire IIFE in an additional safety catch that transitions the session to error state.

**Rationale**: Node.js unhandled rejections can crash the process (default behavior in Node 15+). The server has no global `process.on('unhandledRejection')` handler.

**Alternatives considered**:
- Adding a global unhandledRejection handler: Good defense-in-depth but doesn't fix the root cause.
- Converting to Effect stream: Would be architecturally cleaner but is a larger refactor outside the scope of this fix.

## R-006: Provider Session Status Mapping

**Decision**: The orchestration session status enum includes: `idle`, `starting`, `running`, `ready`, `interrupted`, `stopped`, `error`. The Claude Code adapter internal statuses are: `connecting`, `ready`, `running`, `error`, `closed`. The mapping must ensure that error states are correctly propagated to orchestration so the UI reflects the true session state.

**Rationale**: The existing `ProviderRuntimeIngestion` maps provider events to orchestration commands, including `session.exited` → `thread.session-set` with appropriate status. This mapping is correct but the recovery flow needs to emit proper status transitions during teardown → reconnect → ready.

**Alternatives considered**: None — the existing mapping is sound; only the recovery flow needs to emit the right sequence of events.
