/**
 * before_prompt_build hook — Auto-inject cross-agent episode context.
 * Only activates when ctx.agentId === "zenith" and enableCrossAgentRecall is true.
 */

import type { MemoryBackend } from "../types.js";
import type { HermesLearningConfig } from "../config.js";
import type { PluginLogger, HookAgentContext } from "../types.js";

const SEARCH_TIMEOUT_MS = 5000;
const MAX_INJECT_CHARS = 3000;

export function createZenithContextHandler(
  cfg: HermesLearningConfig,
  backend: MemoryBackend,
  logger: PluginLogger,
) {
  return async (
    event: Record<string, unknown>,
    ctx?: HookAgentContext,
  ): Promise<{ appendSystemContext?: string } | void> => {
    // Only for Zenith
    if (ctx?.agentId !== "zenith") return;
    if (!cfg.enableCrossAgentRecall) return;

    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    if (!prompt || prompt.length < 10) return;

    // Search across other agent scopes
    const otherAgents = cfg.crossAgentScopes.filter((a) => a !== "zenith");
    const snippets: string[] = [];

    try {
      const searches = otherAgents.map(async (agentId) => {
        try {
          const found = await backend.find(
            prompt,
            { targetUri: "viking://agent/memories", limit: 2, scoreThreshold: 0.2 },
            agentId,
          );
          for (const mem of found.memories ?? []) {
            if (mem.abstract) {
              snippets.push(`[${agentId}] ${mem.abstract}`);
            }
          }
        } catch {}
      });

      // Race all searches against timeout
      await Promise.race([
        Promise.allSettled(searches),
        new Promise((resolve) => setTimeout(resolve, SEARCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      logger.warn(`self-learning: zenith cross-agent recall failed: ${err}`);
      return;
    }

    if (snippets.length === 0) return;

    // Trim to budget
    let context = snippets.join("\n");
    if (context.length > MAX_INJECT_CHARS) {
      context = context.slice(0, MAX_INJECT_CHARS) + "\n...";
    }

    return {
      appendSystemContext:
        `\n\n<cross-agent-context>\n` +
        `Recent activity from other agents:\n${context}\n` +
        `</cross-agent-context>`,
    };
  };
}
