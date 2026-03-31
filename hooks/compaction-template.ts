/**
 * before_compaction hook — Inject structured summary template.
 * The compaction LLM uses this template to produce structured output
 * instead of free-form summarization.
 */

import type { HermesLearningConfig } from "../config.js";
import type { HookAgentContext } from "../types.js";

const STRUCTURED_TEMPLATE = `When compacting this conversation, structure your summary using this exact format:

## Goal
[Primary objective of this session — what the user wants to accomplish]

## Constraints & Preferences
[Active constraints, user preferences, coding style, environment limitations]

## Progress
- Done: [Completed items — include specific file paths, commands run, results obtained]
- In Progress: [Current work that is not yet finished]
- Blocked: [Any blockers or issues encountered]

## Key Decisions
[Important technical decisions and their rationale — why, not just what]

## Relevant Files
[Files read, modified, or created — with brief note on each]

## Next Steps
[What should happen next to continue the work]

## Critical Context
[Specific values, error messages, configuration details, or data that would be lost without explicit preservation. Include exact commands, paths, and outputs.]

IMPORTANT: Be specific. Include file paths, command outputs, error messages, and configuration values. Generic summaries lose critical context.`;

export function createCompactionTemplateHandler(cfg: HermesLearningConfig) {
  return async (
    event: Record<string, unknown>,
    ctx?: HookAgentContext,
  ): Promise<{ prependContext?: string } | void> => {
    if (!cfg.enableCompaction) return;

    return {
      prependContext: STRUCTURED_TEMPLATE,
    };
  };
}
