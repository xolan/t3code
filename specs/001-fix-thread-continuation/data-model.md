# Data Model: Fix Thread Continuation

## Entities

### ClaudeSessionContext (Adapter-internal)

**Location**: `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts`

| Field | Type | Description |
|-------|------|-------------|
| threadId | ThreadId | Immutable thread identifier |
| query | ClaudeQuery | SDK query object (async iterable) |
| pendingApprovals | Map | In-flight approval requests |
| pushPrompt | function | Writes user message to SDK stream |
| sessionId | string \| null | SDK-assigned session ID |
| currentTurnId | TurnId \| null | Active turn (null when idle) |
| status | enum | `connecting` \| `ready` \| `running` \| `error` \| `closed` |
| model | string \| undefined | Active model |
| cwd | string \| undefined | Working directory |
| lastError | string \| undefined | Most recent error message |
| resumeCursor | unknown \| undefined | SDK resume state for session recovery |

**State transitions**:
```
connecting → ready → running ⟷ ready
                ↓         ↓
              error     error
                ↓         ↓
              closed    closed
```

**New transition for recovery**:
```
error → [teardown] → [removed from sessions map] → connecting (new session) → ready
```

### OrchestrationSession (Domain model)

**Location**: `packages/contracts/src/orchestration.ts`

| Field | Type | Description |
|-------|------|-------------|
| threadId | ThreadId | Thread identifier |
| status | OrchestrationSessionStatus | `idle` \| `starting` \| `running` \| `ready` \| `interrupted` \| `stopped` \| `error` |
| providerName | ProviderKind \| null | `codex` \| `claudeCode` |
| runtimeMode | RuntimeMode | `approval-required` \| `full-access` |
| activeTurnId | TurnId \| null | Currently executing turn |
| lastError | string \| null | Most recent error |
| updatedAt | IsoDateTime | Last state change timestamp |

**No schema changes needed** — existing status enum already covers all required states.

### ProviderRuntimeBinding (Persistence)

**Location**: `apps/server/src/provider/Services/ProviderSessionDirectory.ts`

| Field | Type | Description |
|-------|------|-------------|
| threadId | ThreadId | Thread identifier |
| provider | ProviderKind | Provider type |
| status | ProviderSessionRuntimeStatus | `starting` \| `running` \| `stopped` \| `error` |
| resumeCursor | unknown \| null | SDK resume state |
| runtimePayload | unknown \| null | { cwd, model, activeTurnId, lastError } |
| runtimeMode | RuntimeMode | Runtime mode |

**No schema changes needed** — existing fields support recovery flow.

## Validation Rules

1. A thread MUST have at most one active provider session at any time.
2. A session in `error` or `closed` status MUST NOT accept new turns.
3. Session teardown MUST cancel all pending approvals before removing the session.
4. Recovery MUST preserve the thread's `resumeCursor` from the previous session if available.
5. Concurrent recovery attempts for the same threadId MUST be serialized (only one proceeds).

## State Transition: Recovery Flow

```
Thread State: session.status = "error"
  ↓
User sends message → turn-start-requested event
  ↓
ProviderCommandReactor.ensureSessionForThread()
  detects session in error state
  ↓
adapter.stopSession(threadId) → session removed from map
  ↓
adapter.startSession({ threadId, resumeCursor? }) → new session created
  ↓
Thread State: session.status = "ready"
  ↓
providerService.sendTurn() → turn dispatched
  ↓
Thread State: session.status = "running", activeTurnId set
```
