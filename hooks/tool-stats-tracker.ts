/**
 * after_tool_call hook — Accumulate tool execution stats per agent run.
 * Stats are held in-memory and flushed on agent_end by skill-reviewer.ts.
 */

import type { RunToolStats, ToolCallAccumulator, HookAgentContext } from "../types.js";

// In-memory accumulator: runId -> RunToolStats
const runStats = new Map<string, RunToolStats>();
// Secondary index: sessionKey -> Set<runId>
const sessionIndex = new Map<string, Set<string>>();

export function getRunStats(runId: string): RunToolStats | undefined {
  return runStats.get(runId);
}

/**
 * Get aggregated stats for all runs within a session.
 * Used by agent_end which only receives sessionKey (no runId).
 */
export function getRunStatsBySession(sessionKey: string): RunToolStats | undefined {
  const runIds = sessionIndex.get(sessionKey);
  if (!runIds || runIds.size === 0) return undefined;

  let merged: RunToolStats | undefined;
  for (const rid of runIds) {
    const stats = runStats.get(rid);
    if (!stats) continue;
    if (!merged) {
      // Clone the first one as base
      merged = {
        runId: rid,
        sessionKey: stats.sessionKey,
        agentId: stats.agentId,
        toolCalls: new Map(stats.toolCalls),
        startedAt: stats.startedAt,
      };
      continue;
    }
    // Merge subsequent runs into the aggregate
    for (const [toolName, acc] of stats.toolCalls) {
      const existing = merged.toolCalls.get(toolName);
      if (existing) {
        existing.callCount += acc.callCount;
        existing.successCount += acc.successCount;
        existing.failureCount += acc.failureCount;
        existing.totalDurationMs += acc.totalDurationMs;
        if (acc.lastError) existing.lastError = acc.lastError;
      } else {
        merged.toolCalls.set(toolName, { ...acc });
      }
    }
    if (stats.startedAt < merged.startedAt) merged.startedAt = stats.startedAt;
  }
  return merged;
}

export function clearRunStats(runId: string): void {
  const stats = runStats.get(runId);
  if (stats?.sessionKey) {
    const sids = sessionIndex.get(stats.sessionKey);
    if (sids) {
      sids.delete(runId);
      if (sids.size === 0) sessionIndex.delete(stats.sessionKey);
    }
  }
  runStats.delete(runId);
}

/**
 * Clear all run stats for a session (used after agent_end flushes).
 */
export function clearSessionStats(sessionKey: string): void {
  const runIds = sessionIndex.get(sessionKey);
  if (runIds) {
    for (const rid of runIds) runStats.delete(rid);
    sessionIndex.delete(sessionKey);
  }
}

// Diagnostic: expose map sizes for external inspection
export function getDiagnostics(): { runStatsSize: number; sessionIndexSize: number; entries: string[] } {
  const entries: string[] = [];
  for (const [rid, stats] of runStats) {
    let totalCalls = 0;
    for (const [, acc] of stats.toolCalls) totalCalls += acc.callCount;
    entries.push(`run=${rid} agent=${stats.agentId} session=${stats.sessionKey} tools=${totalCalls}`);
  }
  return { runStatsSize: runStats.size, sessionIndexSize: sessionIndex.size, entries };
}

export function createToolStatsHandler(logger?: { info: (msg: string) => void; warn: (msg: string) => void }) {
  return async (
    event: Record<string, unknown>,
    ctx?: HookAgentContext,
  ): Promise<void> => {
    const runId = ctx?.runId ?? ctx?.sessionKey ?? "unknown";
    const agentId = ctx?.agentId ?? "unknown";
    const sessionKey = ctx?.sessionKey ?? "";

    const toolName = String(event.toolName ?? event.name ?? "unknown");

    logger?.info(
      `self-learning: [after_tool_call] tool=${toolName} agent=${agentId} runId=${runId} sessionKey=${sessionKey} ` +
      `ctxKeys=${ctx ? Object.keys(ctx).join(",") : "none"} eventKeys=${Object.keys(event).join(",")}`
    );

    // Initialize run stats if first tool call in this run
    if (!runStats.has(runId)) {
      runStats.set(runId, {
        runId,
        sessionKey,
        agentId,
        toolCalls: new Map(),
        startedAt: Date.now(),
      });
      // Maintain session index for agent_end lookup (which only has sessionKey)
      if (sessionKey) {
        let sids = sessionIndex.get(sessionKey);
        if (!sids) {
          sids = new Set();
          sessionIndex.set(sessionKey, sids);
        }
        sids.add(runId);
      }
    }

    const stats = runStats.get(runId)!;
    const durationMs = typeof event.durationMs === "number" ? event.durationMs : 0;
    const hasError = Boolean(event.error);
    const errorMsg = event.error ? String(event.error) : undefined;

    // Get or create accumulator for this tool
    let acc = stats.toolCalls.get(toolName);
    if (!acc) {
      acc = {
        toolName,
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
      };
      stats.toolCalls.set(toolName, acc);
    }

    acc.callCount++;
    acc.totalDurationMs += durationMs;
    if (hasError) {
      acc.failureCount++;
      acc.lastError = errorMsg?.slice(0, 500);
    } else {
      acc.successCount++;
    }
  };
}

/**
 * Format accumulated stats as markdown for memory backend.
 */
export function formatToolStatsMarkdown(stats: RunToolStats): string {
  const lines: string[] = [
    `# Tool Usage Stats`,
    ``,
    `Agent: ${stats.agentId}`,
    `Session: ${stats.sessionKey}`,
    `Timestamp: ${new Date(stats.startedAt).toISOString()}`,
    ``,
    `## Tools Used`,
    ``,
  ];

  let totalCalls = 0;
  for (const [, acc] of stats.toolCalls) {
    totalCalls += acc.callCount;
    const successRate = acc.callCount > 0 ? Math.round((acc.successCount / acc.callCount) * 100) : 0;
    const avgMs = acc.callCount > 0 ? Math.round(acc.totalDurationMs / acc.callCount) : 0;

    lines.push(`### ${acc.toolName}`);
    lines.push(`- Calls: ${acc.callCount} (${successRate}% success)`);
    lines.push(`- Avg duration: ${avgMs}ms`);
    if (acc.lastError) {
      lines.push(`- Last error: ${acc.lastError}`);
    }
    lines.push(``);
  }

  lines.push(`**Total tool calls: ${totalCalls}**`);
  return lines.join("\n");
}
