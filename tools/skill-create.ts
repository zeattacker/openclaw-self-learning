/**
 * skill_create tool — Create a new SKILL.md with YAML frontmatter.
 * Ported from hermes-agent/tools/skill_manager_tool.py _create_skill().
 */

import { mkdirSync, writeFileSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { parse as parseYaml } from "yaml";
import { scanSkillContent, shouldAllowSkill } from "../security-scanner.js";
import { findSkill, validateName, validateFrontmatter } from "./skill-utils.js";

export const skillCreateSchema = Type.Object({
  name: Type.String({ description: "Skill name (lowercase, hyphens/underscores, max 64 chars)" }),
  content: Type.String({ description: "Full SKILL.md content with YAML frontmatter (---name/description---) and instructions body" }),
  category: Type.Optional(Type.String({ description: "Optional category subdirectory (e.g. 'devops', 'data')" })),
});

export function createSkillCreateTool(skillsDir: string) {
  return {
    name: "skill_create",
    label: "Create Skill",
    description:
      "Create a new reusable skill from a successful workflow. " +
      "Skills capture how to do a specific type of task based on proven experience. " +
      "Content must be a SKILL.md with YAML frontmatter (name, description) and instruction body.",
    parameters: skillCreateSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const name = String(params.name ?? "");
      const content = String(params.content ?? "");
      const category = params.category ? String(params.category) : undefined;

      // Validate name
      const nameErr = validateName(name);
      if (nameErr) return JSON.stringify({ success: false, error: nameErr });

      // Validate frontmatter
      const fmErr = validateFrontmatter(content);
      if (fmErr) return JSON.stringify({ success: false, error: fmErr });

      // Check collision
      const existing = findSkill(name, skillsDir);
      if (existing) {
        return JSON.stringify({
          success: false,
          error: `A skill named '${name}' already exists at ${existing}.`,
        });
      }

      // Security scan
      const scanResult = scanSkillContent(content);
      const { allowed, reason } = shouldAllowSkill(scanResult);
      if (!allowed) {
        return JSON.stringify({ success: false, error: reason });
      }

      // Resolve target directory
      const skillDir = category ? join(skillsDir, category, name) : join(skillsDir, name);
      const skillMd = join(skillDir, "SKILL.md");

      // Atomic write: temp file then rename
      mkdirSync(skillDir, { recursive: true });
      const tmpPath = join(skillDir, `.SKILL.md.tmp.${randomBytes(4).toString("hex")}`);
      try {
        writeFileSync(tmpPath, content, "utf-8");
        renameSync(tmpPath, skillMd);
      } catch (err) {
        try { unlinkSync(tmpPath); } catch {}
        // Clean up empty dir
        try { rmSync(skillDir, { recursive: true }); } catch {}
        return JSON.stringify({
          success: false,
          error: `Failed to write skill: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const result: Record<string, unknown> = {
        success: true,
        message: `Skill '${name}' created.`,
        path: skillDir,
      };
      if (category) result.category = category;
      if (scanResult.verdict === "caution") {
        result.warning = `Security scan found ${scanResult.findings.length} finding(s) — allowed but review recommended.`;
      }
      result.hint =
        "To add reference files, use skill_patch or write supporting files to " +
        `${skillDir}/references/, templates/, scripts/, or assets/.`;

      return JSON.stringify(result);
    },
  };
}
