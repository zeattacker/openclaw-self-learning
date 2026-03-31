/**
 * agent_end hook — Flush tool stats to memory backend and spawn skill review subagent.
 *
 * When an agent run completes with enough tool calls (>= threshold),
 * spawns a background subagent to review the session and decide if
 * the workflow should be saved as a reusable skill.
 */

import { randomUUID } from "node:crypto";
import type { MemoryBackend } from "../types.js";
import type { HermesLearningConfig } from "../config.js";
import type { PluginLogger, HookAgentContext } from "../types.js";
import { getRunStats, getRunStatsBySession, clearRunStats, clearSessionStats, formatToolStatsMarkdown, getDiagnostics } from "./tool-stats-tracker.js";

const SKILL_REVIEW_PROMPT = `Review the conversation above and identify if the approach used is reusable and worth saving as a skill for the future.

A good skill captures a workflow that:
- Involved 5+ tool calls or complex multi-step reasoning
- Solved a non-trivial problem that could recur
- Has clear steps that can be reproduced

If you find a reusable workflow:
1. Use skill_list to check if a similar skill already exists
2. If it exists and needs updating, use skill_patch to refine it
3. If it's new, use skill_create to save it with proper YAML frontmatter

SKILL.md format:
\`\`\`
---
name: skill-name
description: Brief description of what the skill does
version: 1.0.0
metadata:
  tags: [category1, category2]
  auto_created: true
---

# Skill Title

## When to Use
[Triggers and conditions]

## Steps
[Step-by-step procedure]

## Common Pitfalls
[Known issues and workarounds]

## Verification
[How to confirm success]
\`\`\`

If nothing stands out as worth saving, simply respond "Nothing to save." and stop.`;

type SubagentApi = {
  run: (params: {
    sessionKey: string;
    message: string;
    extraSystemPrompt?: string;
    deliver?: boolean;
    idempotencyKey?: string;
  }) => Promise<unknown>;
};

export function createSkillReviewerHandler(
  cfg: HermesLearningConfig,
  backend: MemoryBackend | null,
  logger: PluginLogger,
  subagentApi?: SubagentApi,
) {
  return async (
    event: Record<string, unknown>,
    ctx?: HookAgentContext,
  ): Promise<void> => {
    const agentId = ctx?.agentId ?? "unknown";
    const sessionKey = ctx?.sessionKey ?? "unknown";

    // Diagnostic dump
    const diag = getDiagnostics();
    logger.info(
      `self-learning: [agent_end] ENTERED agent=${agentId} sessionKey=${sessionKey} runId=${ctx?.runId ?? "none"} ` +
      `ctxKeys=${ctx ? Object.keys(ctx).join(",") : "none"} eventKeys=${Object.keys(event).join(",")}`
    );
    logger.info(
      `self-learning: [agent_end] stats map: ${diag.runStatsSize} runs, ${diag.sessionIndexSize} sessions. ` +
      `Entries: ${diag.entries.length > 0 ? diag.entries.join(" | ") : "EMPTY"}`
    );

    // agent_end context has sessionKey but no runId.
    // Tool stats are keyed by runId (from after_tool_call which has PluginHookToolContext).
    // Use session-based aggregation to bridge the gap.
    const stats = ctx?.runId
      ? getRunStats(ctx.runId)
      : getRunStatsBySession(sessionKey);

    if (!stats) {
      logger.warn(
        `self-learning: [agent_end] NO STATS found for agent=${agentId} sessionKey=${sessionKey} runId=${ctx?.runId ?? "none"} — ` +
        `skipping skill review. This means after_tool_call never fired or runId/sessionKey mismatch.`
      );
      return;
    }

    // Count total tool calls
    let totalToolCalls = 0;
    for (const [, acc] of stats.toolCalls) {
      totalToolCalls += acc.callCount;
    }

    logger.info(
      `self-learning: agent_end for ${agentId} session=${sessionKey}, ${totalToolCalls} tool calls`,
    );

    // Flush tool stats to memory backend (fire-and-forget)
    if (cfg.enableToolStats && backend && totalToolCalls > 0) {
      const markdown = formatToolStatsMarkdown(stats);
      const dateStr = new Date().toISOString().slice(0, 10);
      const suffix = sessionKey.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 40);
      const uri = `viking://agent/memories/tools/run-${dateStr}-${suffix}.md`;
      backend.writeFile(uri, markdown, agentId).catch((err) => {
        logger.warn(`self-learning: failed to write tool stats: ${err}`);
      });
    }

    logger.info(
      `self-learning: [agent_end] agent=${agentId} totalToolCalls=${totalToolCalls} threshold=${cfg.skillReviewThreshold} ` +
      `enableSkillReview=${cfg.enableSkillReview} hasSubagentApi=${!!subagentApi}`
    );

    // Spawn skill review subagent if threshold met
    if (
      cfg.enableSkillReview &&
      subagentApi &&
      totalToolCalls >= cfg.skillReviewThreshold
    ) {
      const reviewSessionKey = `${sessionKey}:skill-review`;

      logger.info(
        `self-learning: ${agentId} used ${totalToolCalls} tool calls, spawning skill review`,
      );

      // Non-blocking: fire and forget
      subagentApi
        .run({
          sessionKey: reviewSessionKey,
          idempotencyKey: randomUUID(),
          message: SKILL_REVIEW_PROMPT,
          extraSystemPrompt:
            `You are a skill reviewer for agent '${agentId}'. ` +
            `You have access to skill_create, skill_patch, and skill_list tools. ` +
            `Skills are stored at ${cfg.skillsDir}. ` +
            `Only create skills for genuinely reusable workflows.`,
          deliver: false, // Background, no response needed
        })
        .catch((err) => {
          logger.warn(`self-learning: skill review subagent failed: ${err}`);
        });
    }

    // Cleanup — clear by runId if available, otherwise clear entire session
    if (ctx?.runId) {
      clearRunStats(ctx.runId);
    } else {
      clearSessionStats(sessionKey);
    }
  };
}
