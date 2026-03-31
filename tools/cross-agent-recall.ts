/**
 * cross_agent_recall tool — Search memories/episodes across agent scopes.
 * Enables Zenith (CEO) to recall what other agents discussed/decided.
 */

import { Type } from "@sinclair/typebox";
import type { MemoryBackend, FindResultItem } from "../types.js";
import type { HermesLearningConfig } from "../config.js";
import type { PluginLogger } from "../types.js";

export const crossAgentRecallSchema = Type.Object({
  query: Type.String({ description: "Search query — what you want to recall from other agents" }),
  agents: Type.Optional(
    Type.Array(Type.String(), {
      description: "Agent IDs to search (default: all configured agents)",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results per agent (default: 3)" })),
});

type AgentResult = {
  agentId: string;
  results: Array<FindResultItem & { agentId: string }>;
};

export function createCrossAgentRecallTool(
  cfg: HermesLearningConfig,
  backend: MemoryBackend,
  logger: PluginLogger,
) {
  return {
    name: "cross_agent_recall",
    label: "Cross-Agent Recall",
    description:
      "Search memories and episodes across other agents. " +
      "Use this to recall what Cipher discussed about infrastructure, " +
      "what Ledger calculated for finances, what Orion reported on operations, etc.",
    parameters: crossAgentRecallSchema,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const query = String(params.query ?? "");
      const agents = Array.isArray(params.agents)
        ? params.agents.filter((a): a is string => typeof a === "string")
        : cfg.crossAgentScopes;
      const limit = typeof params.limit === "number" ? params.limit : 3;

      if (!query) return JSON.stringify({ error: "query is required" });

      // Search across agent scopes in parallel (with timeout)
      const results: AgentResult[] = [];
      const TIMEOUT_MS = 5000;

      const searches = agents.map(async (agentId) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const found = await backend.find(
              query,
              { targetUri: "viking://agent/memories", limit, scoreThreshold: 0.1 },
              agentId,
            );

            const items: Array<FindResultItem & { agentId: string }> = [];
            for (const mem of found.memories ?? []) {
              items.push({ ...mem, agentId });
            }
            if (items.length > 0) {
              results.push({ agentId, results: items });
            }
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          // Fail open: skip agent on error
          logger.warn(`self-learning: cross-agent search failed for ${agentId}: ${err}`);
        }
      });

      await Promise.allSettled(searches);

      // Deduplicate by URI
      const seen = new Set<string>();
      const deduped: Array<{ agentId: string; uri: string; abstract?: string; score?: number }> = [];
      for (const agentResult of results) {
        for (const item of agentResult.results) {
          if (!seen.has(item.uri)) {
            seen.add(item.uri);
            deduped.push({
              agentId: item.agentId,
              uri: item.uri,
              abstract: item.abstract,
              score: item.score,
            });
          }
        }
      }

      // Sort by score descending
      deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      // Track recall for hotness scoring
      const uris = deduped.map((d) => d.uri);
      backend.trackRecall(uris).catch(() => {});

      return JSON.stringify({
        query,
        agentsSearched: agents.length,
        totalResults: deduped.length,
        results: deduped.map((d) => ({
          agent: d.agentId,
          uri: d.uri,
          summary: d.abstract ?? "(no summary)",
          score: d.score,
        })),
      });
    },
  };
}
