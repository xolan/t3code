/**
 * Slash Command Discovery — reads `.claude/commands/*.md` from the project
 * workspace and parses YAML frontmatter into `SlashCommandDefinition` values.
 *
 * @module slashCommands
 */
import { Effect, FileSystem, Path } from "effect";
import type { SlashCommandDefinition } from "@t3tools/contracts";
import { parse as parseYaml } from "yaml";

const COMMANDS_DIR = ".claude/commands";

/**
 * Split a markdown file into YAML frontmatter and body.
 * Returns `null` when the file does not start with `---`.
 */
function splitFrontmatter(content: string): { yaml: string; body: string } | null {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return null;
  const yaml = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 4).trim();
  return { yaml, body };
}

interface ParsedFrontmatter {
  description?: string;
  handoffs?: Array<{
    label?: string;
    agent?: string;
    prompt?: string;
    send?: boolean;
  }>;
}

function parseCommandFile(
  fileName: string,
  content: string,
): SlashCommandDefinition | null {
  const parts = splitFrontmatter(content);
  if (!parts) return null;

  let frontmatter: ParsedFrontmatter;
  try {
    frontmatter = parseYaml(parts.yaml) as ParsedFrontmatter;
  } catch {
    return null;
  }

  if (!frontmatter || typeof frontmatter.description !== "string") return null;

  const id = fileName.replace(/\.md$/, "");
  const handoffs = Array.isArray(frontmatter.handoffs)
    ? frontmatter.handoffs
        .filter(
          (h): h is { label: string; agent: string; prompt: string; send?: boolean } =>
            typeof h?.label === "string" &&
            typeof h?.agent === "string" &&
            typeof h?.prompt === "string",
        )
        .map((h) => {
          const entry: { label: string; agent: string; prompt: string; send?: boolean } = {
            label: h.label,
            agent: h.agent,
            prompt: h.prompt,
          };
          if (typeof h.send === "boolean") {
            entry.send = h.send;
          }
          return entry;
        })
    : [];

  return {
    id,
    name: `/${id}`,
    description: frontmatter.description,
    body: parts.body,
    handoffs,
  };
}

/**
 * Discover and parse all `.claude/commands/*.md` files under the given
 * workspace root. Returns an empty array when the directory is missing.
 */
export const listSlashCommands = (
  cwd: string,
): Effect.Effect<SlashCommandDefinition[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const commandsDir = path.resolve(cwd, COMMANDS_DIR);

    const exists = yield* fs.exists(commandsDir);
    if (!exists) return [];

    const entries = yield* fs.readDirectory(commandsDir);
    const mdFiles = entries.filter((name) => name.endsWith(".md")).toSorted();

    const definitions: SlashCommandDefinition[] = [];
    for (const fileName of mdFiles) {
      const filePath = path.resolve(commandsDir, fileName);
      const contentBytes = yield* fs.readFile(filePath);
      const content = new TextDecoder().decode(contentBytes);
      const definition = parseCommandFile(fileName, content);
      if (definition) {
        definitions.push(definition);
      }
    }

    return definitions;
  }).pipe(
    // Gracefully degrade — if anything goes wrong reading commands, return empty
    Effect.catch(() => Effect.succeed([] as SlashCommandDefinition[])),
  );
