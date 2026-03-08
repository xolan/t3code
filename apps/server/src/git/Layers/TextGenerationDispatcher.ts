/**
 * TextGenerationDispatcher - Routes text generation to the correct provider CLI.
 *
 * Uses the `provider` hint on each input to pick the right backend.
 * Falls back to whichever CLI is available when no hint is given.
 */
import type { ProviderKind } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { TextGenerationError } from "../Errors.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";

const makeTextGenerationDispatcher = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const isAvailable = (binary: string): Effect.Effect<boolean> =>
    commandSpawner
      .spawn(ChildProcess.make(binary, ["--version"]))
      .pipe(
        Effect.scoped,
        Effect.flatMap((child) => child.exitCode),
        Effect.map((code) => Number(code) === 0),
        Effect.catch(() => Effect.succeed(false)),
      );

  const [hasClaude, hasCodex] = yield* Effect.all(
    [isAvailable("claude"), isAvailable("codex")],
    { concurrency: "unbounded" },
  );

  let claudeBackend: TextGenerationShape | null = null;
  let codexBackend: TextGenerationShape | null = null;

  if (hasClaude) {
    const mod = yield* Effect.tryPromise({
      try: () => import("./ClaudeTextGeneration.ts"),
      catch: () =>
        new TextGenerationError({
          operation: "init",
          detail: "Failed to load ClaudeTextGeneration module.",
        }),
    });
    claudeBackend = yield* mod.makeClaudeTextGeneration;
  }

  if (hasCodex) {
    const mod = yield* Effect.tryPromise({
      try: () => import("./CodexTextGeneration.ts"),
      catch: () =>
        new TextGenerationError({
          operation: "init",
          detail: "Failed to load CodexTextGeneration module.",
        }),
    });
    codexBackend = yield* mod.makeCodexTextGeneration;
  }

  const fallbackBackend = claudeBackend ?? codexBackend;

  function resolve(provider: ProviderKind | undefined): TextGenerationShape {
    if (provider === "claudeCode" && claudeBackend) return claudeBackend;
    if (provider === "codex" && codexBackend) return codexBackend;
    if (fallbackBackend) return fallbackBackend;
    // Unreachable if either CLI is installed, but satisfy the type system
    const fail = (operation: string) =>
      Effect.fail(
        new TextGenerationError({
          operation,
          detail:
            "No AI CLI is available for text generation. Install either Claude CLI (`claude`) or Codex CLI (`codex`).",
        }),
      );
    return {
      generateCommitMessage: () => fail("generateCommitMessage"),
      generatePrContent: () => fail("generatePrContent"),
      generateBranchName: () => fail("generateBranchName"),
    };
  }

  return {
    generateCommitMessage: (input) => resolve(input.provider).generateCommitMessage(input),
    generatePrContent: (input) => resolve(input.provider).generatePrContent(input),
    generateBranchName: (input) => resolve(input.provider).generateBranchName(input),
  } satisfies TextGenerationShape;
});

export const TextGenerationDispatcherLive = Layer.effect(
  TextGeneration,
  makeTextGenerationDispatcher,
);
