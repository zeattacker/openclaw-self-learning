/**
 * skill_patch tool — Targeted find-and-replace within a skill's SKILL.md.
 * Ported from hermes-agent/tools/skill_manager_tool.py _patch_skill().
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { scanSkillContent, shouldAllowSkill } from "../security-scanner.js";
import { findSkill, validateFrontmatter, validateFilePath } from "./skill-utils.js";

export const skillPatchSchema = Type.Object({
  name: Type.String({ description: "Name of the skill to patch" }),
  old_string: Type.String({ description: "Exact text to find in the skill file" }),
  new_string: Type.String({ description: "Replacement text" }),
  file_path: Type.Optional(Type.String({
    description: "Relative path within skill dir (e.g. 'references/guide.md'). Defaults to SKILL.md",
  })),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: false)" })),
});

export function createSkillPatchTool(skillsDir: string) {
  return {
    name: "skill_patch",
    label: "Patch Skill",
    description:
      "Targeted find-and-replace within a skill file. " +
      "Use this to refine an existing skill when you discover errors or improvements. " +
      "Defaults to patching SKILL.md; use file_path for supporting files.",
    parameters: skillPatchSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const name = String(params.name ?? "");
      const oldString = String(params.old_string ?? "");
      const newString = String(params.new_string ?? "");
      const filePath = params.file_path ? String(params.file_path) : null;
      const replaceAll = params.replace_all === true;

      if (!oldString) return JSON.stringify({ success: false, error: "old_string is required." });
      if (oldString === newString) return JSON.stringify({ success: false, error: "old_string and new_string are identical." });

      const skillDir = findSkill(name, skillsDir);
      if (!skillDir) {
        return JSON.stringify({ success: false, error: `Skill '${name}' not found.` });
      }

      // Determine target file
      let targetFile: string;
      if (filePath) {
        const fpErr = validateFilePath(filePath);
        if (fpErr) return JSON.stringify({ success: false, error: fpErr });
        targetFile = join(skillDir, filePath);
      } else {
        targetFile = join(skillDir, "SKILL.md");
      }

      // Read current content
      let content: string;
      try {
        content = readFileSync(targetFile, "utf-8");
      } catch {
        return JSON.stringify({ success: false, error: `File not found: ${filePath ?? "SKILL.md"}` });
      }

      // Check uniqueness (unless replace_all)
      if (!replaceAll) {
        const count = content.split(oldString).length - 1;
        if (count === 0) {
          return JSON.stringify({ success: false, error: "old_string not found in file." });
        }
        if (count > 1) {
          return JSON.stringify({
            success: false,
            error: `old_string found ${count} times. Set replace_all=true or provide a more unique string.`,
          });
        }
      }

      // Apply patch
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      if (newContent === content) {
        return JSON.stringify({ success: false, error: "old_string not found in file." });
      }

      // If patching SKILL.md, validate frontmatter integrity
      if (!filePath) {
        const fmErr = validateFrontmatter(newContent);
        if (fmErr) {
          return JSON.stringify({ success: false, error: `Patch would break frontmatter: ${fmErr}` });
        }
      }

      // Security scan after patch
      const scanResult = scanSkillContent(newContent);
      const { allowed, reason } = shouldAllowSkill(scanResult);
      if (!allowed) {
        return JSON.stringify({ success: false, error: `Patch blocked by security scan: ${reason}` });
      }

      // Atomic write
      const tmpPath = `${targetFile}.tmp.${randomBytes(4).toString("hex")}`;
      try {
        writeFileSync(tmpPath, newContent, "utf-8");
        renameSync(tmpPath, targetFile);
      } catch (err) {
        try { unlinkSync(tmpPath); } catch {}
        return JSON.stringify({
          success: false,
          error: `Failed to write: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
      const result: Record<string, unknown> = {
        success: true,
        message: `Patched '${name}' — ${replacements} replacement(s) in ${filePath ?? "SKILL.md"}.`,
      };
      if (scanResult.verdict === "caution") {
        result.warning = `Security scan found ${scanResult.findings.length} finding(s) — review recommended.`;
      }

      return JSON.stringify(result);
    },
  };
}
