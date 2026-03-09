import { Effect, FileSystem, Path } from "effect";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { listSlashCommands } from "./slashCommands";

it.layer(NodeServices.layer)("listSlashCommands", (it) => {
  it.effect("returns empty array when .claude/commands directory does not exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const result = yield* listSlashCommands(dir);
      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("returns empty array when directory has no .md files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });
      yield* fs.writeFileString(path.resolve(commandsDir, "readme.txt"), "not a command");

      const result = yield* listSlashCommands(dir);
      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("parses a minimal command file with description only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });

      const content = [
        "---",
        "description: Run the linter",
        "---",
        "",
        "Please lint all files.",
      ].join("\n");
      yield* fs.writeFileString(path.resolve(commandsDir, "lint.md"), content);

      const result = yield* listSlashCommands(dir);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.id, "lint");
      assert.strictEqual(result[0]!.name, "/lint");
      assert.strictEqual(result[0]!.description, "Run the linter");
      assert.strictEqual(result[0]!.body, "Please lint all files.");
      assert.deepStrictEqual(result[0]!.handoffs, []);
    }),
  );

  it.effect("parses handoffs with send flag", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });

      const content = [
        "---",
        "description: Create a specification",
        "handoffs:",
        "  - label: Build Plan",
        "    agent: speckit.plan",
        "    prompt: Create a plan for the spec",
        "  - label: Clarify Requirements",
        "    agent: speckit.clarify",
        "    prompt: Clarify specification",
        "    send: true",
        "---",
        "",
        "## Specify",
        "",
        "$ARGUMENTS",
      ].join("\n");
      yield* fs.writeFileString(path.resolve(commandsDir, "speckit.specify.md"), content);

      const result = yield* listSlashCommands(dir);
      assert.strictEqual(result.length, 1);
      const cmd = result[0]!;
      assert.strictEqual(cmd.id, "speckit.specify");
      assert.strictEqual(cmd.name, "/speckit.specify");
      assert.strictEqual(cmd.handoffs.length, 2);
      assert.deepStrictEqual(cmd.handoffs[0], {
        label: "Build Plan",
        agent: "speckit.plan",
        prompt: "Create a plan for the spec",
      });
      assert.deepStrictEqual(cmd.handoffs[1], {
        label: "Clarify Requirements",
        agent: "speckit.clarify",
        prompt: "Clarify specification",
        send: true,
      });
    }),
  );

  it.effect("skips files with missing frontmatter", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });

      // No frontmatter at all
      yield* fs.writeFileString(
        path.resolve(commandsDir, "no-front.md"),
        "# Just a markdown file\n\nNo frontmatter here.",
      );

      // Frontmatter without description
      yield* fs.writeFileString(
        path.resolve(commandsDir, "no-desc.md"),
        "---\ntitle: Missing description\n---\n\nBody here.",
      );

      const result = yield* listSlashCommands(dir);
      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("skips handoffs with missing required fields", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });

      const content = [
        "---",
        "description: Test command",
        "handoffs:",
        "  - label: Valid",
        "    agent: some.agent",
        "    prompt: Do something",
        "  - label: Missing agent",
        "    prompt: No agent field",
        "  - agent: missing-label",
        "    prompt: No label field",
        "---",
        "",
        "Body.",
      ].join("\n");
      yield* fs.writeFileString(path.resolve(commandsDir, "partial.md"), content);

      const result = yield* listSlashCommands(dir);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.handoffs.length, 1);
      assert.strictEqual(result[0]!.handoffs[0]!.label, "Valid");
    }),
  );

  it.effect("returns definitions sorted alphabetically by filename", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slash-cmd-test-" });
      const commandsDir = path.resolve(dir, ".claude/commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });

      yield* fs.writeFileString(path.resolve(commandsDir, "zebra.md"), "---\ndescription: zebra command\n---\n\nzebra body.");
      yield* fs.writeFileString(path.resolve(commandsDir, "alpha.md"), "---\ndescription: alpha command\n---\n\nalpha body.");
      yield* fs.writeFileString(path.resolve(commandsDir, "middle.md"), "---\ndescription: middle command\n---\n\nmiddle body.");

      const result = yield* listSlashCommands(dir);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]!.id, "alpha");
      assert.strictEqual(result[1]!.id, "middle");
      assert.strictEqual(result[2]!.id, "zebra");
    }),
  );

  it.effect("parses the real .claude/commands from the project workspace", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      // Tests run from apps/server/ — resolve up to project root
      const projectRoot = path.resolve(process.cwd(), "../..");
      const result = yield* listSlashCommands(projectRoot);

      // We expect at least the known spec-kit commands to be present
      const ids = new Set(result.map((cmd) => cmd.id));
      assert(ids.has("speckit.specify"), "expected speckit.specify");
      assert(ids.has("speckit.plan"), "expected speckit.plan");
      assert(ids.has("speckit.implement"), "expected speckit.implement");
      assert(ids.has("speckit.tasks"), "expected speckit.tasks");

      // Verify structure of a known command
      const specify = result.find((cmd) => cmd.id === "speckit.specify");
      assert(specify !== undefined);
      assert.strictEqual(specify.name, "/speckit.specify");
      assert(specify.description.length > 0, "description should be non-empty");
      assert(specify.body.length > 0, "body should be non-empty");
      assert(specify.handoffs.length > 0, "speckit.specify should have handoffs");
    }),
  );
});
