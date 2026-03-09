# Feature Specification: Fix Thread Continuation

**Feature Branch**: `001-fix-thread-continuation`
**Created**: 2026-03-08
**Status**: Draft
**Input**: User description: "One must be able to continue a thread, regardless of its previous state. Currently it crashes when attempting to send a message on a thread whose provider session is in an error state (e.g., 'Turn interrupt failed after session recovery'), resulting in 'ProcessTransport is not ready for writing' and a server crash."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continue Thread After Error State (Priority: P1)

A user has a thread whose provider session entered an error state (e.g., due to a failed turn interrupt or session recovery failure). The user sends a new message to continue the conversation. The system recovers gracefully: it tears down the broken session, starts a fresh provider session for the thread, and processes the new message without crashing.

**Why this priority**: This is the core bug. Without this fix, users lose their entire thread when the provider session enters any error state, and the server crashes.

**Independent Test**: Can be tested by forcing a thread into an error state (e.g., killing the underlying provider process mid-turn), then sending a new message. The message should be accepted and a new turn should start successfully.

**Acceptance Scenarios**:

1. **Given** a thread with session status "error" and lastError set, **When** the user sends a new message, **Then** the system starts a fresh provider session and begins a new turn without crashing.
2. **Given** a thread with session status "error", **When** the user sends a new message, **Then** the previous error information is cleared from the session state once the new turn starts successfully.
3. **Given** a thread with session status "error", **When** the system fails to start a fresh provider session, **Then** the user sees a clear error message and the server remains stable.

---

### User Story 2 - Continue Thread After Interrupted Turn (Priority: P1)

A user interrupted a turn (e.g., clicked "stop"), and the interruption itself failed or left the session in a stale state. The user sends a new message. The system detects the stale/interrupted state, cleans up, and processes the new message.

**Why this priority**: Turn interruptions are a common user action. If an interruption leaves the session broken, users cannot continue the conversation at all.

**Independent Test**: Can be tested by initiating a turn, requesting an interrupt, and (if the interrupt fails or leaves stale state) sending a follow-up message. The follow-up should succeed.

**Acceptance Scenarios**:

1. **Given** a thread where a turn interrupt was requested but failed, **When** the user sends a new message, **Then** the system recovers and starts a new turn.
2. **Given** a thread with an active turn that is no longer actually running (stale), **When** the user sends a new message, **Then** the system detects the stale state, cleans up, and starts a new turn.

---

### User Story 3 - Server Stability Under Session Failures (Priority: P2)

The server must remain stable even when individual provider sessions crash or become unresponsive. A single broken session must not take down the entire server process.

**Why this priority**: Server crashes affect all connected users, not just the one with the broken thread.

**Independent Test**: Can be tested by triggering multiple concurrent session failures and verifying the server continues to serve other threads.

**Acceptance Scenarios**:

1. **Given** a provider process that crashes unexpectedly, **When** the server detects the crash, **Then** it marks the session as errored and continues serving other threads.
2. **Given** an attempt to write to a terminated provider process, **When** the write fails with "ProcessTransport is not ready", **Then** the error is caught, the session is marked as errored, and the server does not crash.

---

### Edge Cases

- What happens when a user sends rapid messages to a thread in an error state? The system should prevent concurrent recovery attempts and either queue or reject duplicate requests.
- What happens when the provider process exits during session recovery itself? Recovery should have a timeout and fail gracefully with a user-visible error.
- What happens when the user switches threads while recovery is in progress? Recovery should complete in the background without affecting the UI or other threads.
- What happens when a thread has never had a successful turn? Recovery should still work — start a fresh session as if it were the first turn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST catch errors from the provider transport layer (e.g., "ProcessTransport is not ready for writing") without crashing the server process.
- **FR-002**: System MUST detect when a thread's provider session is in an error or stale state before attempting to start a new turn.
- **FR-003**: System MUST automatically tear down and replace a broken provider session when a new turn is requested on an errored thread.
- **FR-004**: System MUST emit appropriate domain events during session recovery so the UI can reflect the recovery state (e.g., "reconnecting", "ready").
- **FR-005**: System MUST prevent concurrent recovery attempts for the same thread.
- **FR-006**: System MUST time-bound session recovery attempts and fail gracefully if recovery exceeds the timeout.
- **FR-007**: System MUST preserve the thread's message history across session recovery (messages are stored independently of the provider session).
- **FR-008**: System MUST clear the previous error state from the session once recovery succeeds.

### Key Entities

- **Thread**: The conversation container. Owns message history and references a provider session. Thread identity persists across session recovery.
- **Provider Session**: The runtime connection to a provider (e.g., Claude Code). Has a lifecycle (idle, running, error). Can be replaced without affecting the thread's identity or message history.
- **Turn**: A single request-response cycle within a thread. A turn requires an active, healthy provider session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can continue any thread regardless of its previous session state — 100% of error-state threads are recoverable by sending a new message.
- **SC-002**: Server process never crashes due to a single provider session failure — zero server-wide crashes from provider transport errors.
- **SC-003**: Session recovery completes within 10 seconds or fails with a user-visible error.
- **SC-004**: Users see clear feedback during recovery (status transitions visible in the UI within 1 second of state change).

## Assumptions

- Message history is persisted server-side independently of the provider session, so no messages are lost during session recovery.
- The provider supports starting a fresh session for an existing thread without requiring the thread to be recreated.
- The "ProcessTransport is not ready for writing" error originates from attempting to write to a provider process that has already exited or was never properly initialized.
- Session recovery involves spawning a new provider process, not reconnecting to the old one.
