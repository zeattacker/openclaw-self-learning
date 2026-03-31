/**
 * Shared skill utilities — validation, search, frontmatter parsing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const ALLOWED_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

export function validateName(name: string): string | null {
  if (!name) return "Skill name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!VALID_NAME_RE.test(name)) {
    return `Invalid skill name '${name}'. Use lowercase letters, numbers, hyphens, dots, underscores. Must start with letter or digit.`;
  }
  return null;
}

export function validateFrontmatter(content: string): string | null {
  if (!content.trim()) return "Content cannot be empty.";
  if (!content.startsWith("---")) {
    return "SKILL.md must start with YAML frontmatter (---). See existing skills for format.";
  }

  const endMatch = content.slice(3).match(/\n---\s*\n/);
  if (!endMatch || endMatch.index === undefined) {
    return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line.";
  }

  const yamlContent = content.slice(3, endMatch.index + 3);
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (err) {
    return `YAML frontmatter parse error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!parsed || typeof parsed !== "object") {
    return "Frontmatter must be a YAML mapping (key: value pairs).";
  }

  const fm = parsed as Record<string, unknown>;
  if (!("name" in fm)) return "Frontmatter must include 'name' field.";
  if (!("description" in fm)) return "Frontmatter must include 'description' field.";
  if (String(fm.description ?? "").length > MAX_DESCRIPTION_LENGTH) {
    return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  const body = content.slice(endMatch.index! + 3 + endMatch[0].length).trim();
  if (!body) {
    return "SKILL.md must have content after the frontmatter (instructions, procedures, etc.).";
  }

  return null;
}

export function validateFilePath(filePath: string): string | null {
  if (!filePath) return "file_path is required.";
  const parts = filePath.split("/").filter(Boolean);
  if (parts.includes("..")) return "Path traversal ('..') is not allowed.";
  if (parts.length === 0 || !ALLOWED_SUBDIRS.has(parts[0]!)) {
    return `File must be under one of: ${[...ALLOWED_SUBDIRS].sort().join(", ")}. Got: '${filePath}'`;
  }
  if (parts.length < 2) {
    return `Provide a file path, not just a directory. Example: '${parts[0]}/myfile.md'`;
  }
  return null;
}

export function findSkill(name: string, skillsDir: string): string | null {
  if (!existsSync(skillsDir)) return null;
  return findSkillRecursive(name, skillsDir);
}

function findSkillRecursive(name: string, dir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (entry === name && existsSync(join(full, "SKILL.md"))) {
      return full;
    }
    // Recurse into subdirectories (categories)
    const found = findSkillRecursive(name, full);
    if (found) return found;
  }
  return null;
}

export type SkillMeta = {
  name: string;
  description: string;
  version?: string;
  category?: string;
  path: string;
  tags?: string[];
};

export function listSkills(skillsDir: string): SkillMeta[] {
  if (!existsSync(skillsDir)) return [];
  const results: SkillMeta[] = [];
  collectSkills(skillsDir, skillsDir, results);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function collectSkills(baseDir: string, dir: string, results: SkillMeta[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = join(full, "SKILL.md");
    if (existsSync(skillMd)) {
      try {
        const content = readFileSync(skillMd, "utf-8");
        const meta = extractFrontmatter(content);
        if (meta) {
          const rel = relative(baseDir, full);
          const parts = rel.split("/");
          results.push({
            name: meta.name || entry,
            description: meta.description || "",
            version: meta.version,
            category: parts.length > 1 ? parts[0] : undefined,
            path: full,
            tags: meta.tags,
          });
        }
      } catch {}
    } else {
      // Recurse into category directories
      collectSkills(baseDir, full, results);
    }
  }
}

function extractFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const endMatch = content.slice(3).match(/\n---\s*\n/);
  if (!endMatch || endMatch.index === undefined) return null;
  try {
    const parsed = parseYaml(content.slice(3, endMatch.index + 3));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
