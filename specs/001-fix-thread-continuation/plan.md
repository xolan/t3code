# Implementation Plan: Fix Thread Continuation

**Branch**: `001-fix-thread-continuation` | **Date**: 2026-03-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-fix-thread-continuation/spec.md`

## Summary

Threads with errored or stale provider sessions crash the server when a user sends a new message ("ProcessTransport is not ready for writing"). The fix adds session-aware recovery: detect broken sessions before dispatching turns, teardown the dead session, start a fresh one, then process the message. Additionally, harden the async SDK stream consumer to prevent unhandled rejections from crashing the server process.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js server, React browser client)
**Primary Dependencies**: Effect-TS, @anthropic-ai/claude-agent-sdk, Bun runtime
**Storage**: SQLite via @effect/sql-sqlite-bun (event store, projections)
**Testing**: Vitest with @effect/vitest (`bun run test`)
**Target Platform**: Node.js server (Linux), browser client
**Project Type**: Web service (monorepo: apps/server, apps/web, packages/contracts, packages/shared)
**Performance Goals**: Session recovery within 10 seconds; zero server crashes from provider errors
**Constraints**: No breaking changes to WebSocket protocol or orchestration event schemas
**Scale/Scope**: Single-user local dev tool; changes scoped to 3 files in apps/server

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Correctness Over Convenience | PASS | Fix eliminates crash-on-error; recovery is explicit, not masked |
| II. Schema-First Contracts | PASS | No new schemas needed; existing OrchestrationSessionStatus already has all required states |
| III. Event-Sourced State | PASS | Recovery emits proper session-set events through the command→event pipeline |
| IV. Provider Abstraction | PASS | Recovery logic lives in ProviderService (cross-provider) and ProviderCommandReactor; adapter interface unchanged |
| V. Shared Logic, No Duplication | PASS | Recovery logic centralized in ProviderService.recoverSessionForThread; not duplicated per-adapter |
| VI. Performance Under Load | PASS | No new hot-path overhead; recovery is rare-path only |
| VII. Explicit Dependencies | PASS | No new services or implicit state; per-thread lock is local to reactor |

**Post-Phase 1 re-check**: All gates still pass. No new contracts, no leaked provider types, no schema changes.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-thread-continuation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
apps/server/src/
├── provider/
│   ├── Layers/
│   │   ├── ClaudeCodeAdapter.ts    # Harden async stream; ensure stopSession cleans up error-state sessions
│   │   └── ProviderService.ts      # Add teardown-before-recovery in recoverSessionForThread
│   └── Errors.ts                   # No changes needed (error types sufficient)
├── orchestration/
│   └── Layers/
│       └── ProviderCommandReactor.ts  # Per-thread recovery guard; handle error-state in ensureSessionForThread
└── main.ts                            # Add global unhandledRejection safety net (defense-in-depth)
```

**Structure Decision**: This is a bug fix scoped entirely to the server package. All changes are in existing files within `apps/server/src/`. No new files, packages, or contracts needed.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
