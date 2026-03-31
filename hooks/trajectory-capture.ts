/**
 * Trajectory capture hooks — llm_input, llm_output, after_tool_call.
 * Buffers entries in memory, flushed periodically by trajectory-writer service.
 */

import type { TrajectoryEntry, HookAgentContext } from "../types.js";

// Shared buffer — drained by trajectory-writer service
const buffer: TrajectoryEntry[] = [];
const MAX_BUFFER = 500;

export function drainBuffer(): TrajectoryEntry[] {
  return buffer.splice(0, buffer.length);
}

export function getBufferSize(): number {
  return buffer.length;
}

function push(entry: TrajectoryEntry): void {
  if (buffer.length >= MAX_BUFFER) {
    // Drop oldest to prevent unbounded growth
    buffer.shift();
  }
  buffer.push(entry);
}

export function createLlmInputHandler() {
  return async (event: Record<string, unknown>, ctx?: HookAgentContext): Promise<void> => {
    push({
      ts: Date.now(),
      type: "llm_input",
      runId: ctx?.runId ?? ctx?.sessionKey ?? "unknown",
      sessionId: ctx?.sessionId,
      agentId: ctx?.agentId,
      data: {
        model: event.model,
        messageCount: Array.isArray(event.messages) ? event.messages.length : undefined,
      },
    });
  };
}

export function createLlmOutputHandler() {
  return async (event: Record<string, unknown>, ctx?: HookAgentContext): Promise<void> => {
    const usage = event.usage as Record<string, unknown> | undefined;
    push({
      ts: Date.now(),
      type: "llm_output",
      runId: ctx?.runId ?? ctx?.sessionKey ?? "unknown",
      sessionId: ctx?.sessionId,
      agentId: ctx?.agentId,
      data: {
        model: event.model,
        promptTokens: usage?.prompt_tokens ?? usage?.promptTokens,
        completionTokens: usage?.completion_tokens ?? usage?.completionTokens,
        finishReason: event.finish_reason ?? event.finishReason,
      },
    });
  };
}

export function createToolCallTrajectoryHandler() {
  return async (event: Record<string, unknown>, ctx?: HookAgentContext): Promise<void> => {
    push({
      ts: Date.now(),
      type: "tool_call",
      runId: ctx?.runId ?? ctx?.sessionKey ?? "unknown",
      sessionId: ctx?.sessionId,
      agentId: ctx?.agentId,
      data: {
        toolName: event.toolName ?? event.name,
        durationMs: event.durationMs,
        error: event.error ? String(event.error).slice(0, 200) : undefined,
      },
    });
  };
}
