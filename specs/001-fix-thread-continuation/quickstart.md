# Quickstart: Fix Thread Continuation

## Problem

When a Claude Code provider session enters an error state (e.g., "Turn interrupt failed after session recovery"), subsequent attempts to send a message on that thread crash the server with "ProcessTransport is not ready for writing".

## Key Files to Modify

| File | Change |
|------|--------|
| `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` | Harden async stream error handling; ensure stopSession fully cleans up errored sessions |
| `apps/server/src/provider/Layers/ProviderService.ts` | Add teardown-before-recovery logic in `recoverSessionForThread` |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | Add per-thread recovery guard in `ensureSessionForThread`; handle error-state sessions |

## Key Files (Read-only Context)

| File | Why |
|------|-----|
| `apps/server/src/provider/Services/ProviderAdapter.ts` | Adapter interface contract |
| `apps/server/src/provider/Errors.ts` | Error type hierarchy |
| `packages/contracts/src/orchestration.ts` | Domain event and session status schemas |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` | How provider events map to orchestration events |

## Development Commands

```bash
# Run dev server
bun run dev

# Typecheck
bun typecheck

# Lint
bun lint

# Run tests (NEVER use `bun test`)
bun run test
```

## Testing Strategy

1. **Unit**: Test that `sendTurn` on an errored session triggers recovery (teardown + new session + turn dispatch) rather than crashing.
2. **Unit**: Test that concurrent turn requests on the same errored thread are serialized (second request waits or is rejected).
3. **Integration**: Start a Claude Code session, force it into error state, send a new message, verify the thread continues.

## Architecture Notes

- The orchestration layer is event-sourced: commands → events → projections. All state changes go through this pipeline.
- Provider adapters are behind the `ProviderAdapterShape` interface. Recovery logic lives in `ProviderService` (cross-provider) and `ProviderCommandReactor` (orchestration-side).
- The Claude Code adapter uses `@anthropic-ai/claude-agent-sdk` with an async iterable stream pattern. Sessions are in-memory maps keyed by threadId.
- Session persistence (for cross-restart recovery) is in `ProviderSessionDirectory`.
