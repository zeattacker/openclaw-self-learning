/**
 * skill_list tool — List available agent-created skills with metadata.
 */

import { Type } from "@sinclair/typebox";
import { listSkills } from "./skill-utils.js";

export const skillListSchema = Type.Object({
  category: Type.Optional(Type.String({ description: "Filter by category" })),
  query: Type.Optional(Type.String({ description: "Filter by name or description substring" })),
});

export function createSkillListTool(skillsDir: string) {
  return {
    name: "skill_list",
    label: "List Skills",
    description:
      "List agent-created skills with their metadata (name, description, version, category). " +
      "Use this to check what skills exist before creating duplicates.",
    parameters: skillListSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const category = params.category ? String(params.category) : undefined;
      const query = params.query ? String(params.query).toLowerCase() : undefined;

      let skills = listSkills(skillsDir);

      if (category) {
        skills = skills.filter((s) => s.category === category);
      }
      if (query) {
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query),
        );
      }

      return JSON.stringify({
        count: skills.length,
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          version: s.version,
          category: s.category,
          tags: s.tags,
        })),
      });
    },
  };
}
