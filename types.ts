/**
 * Shared types for self-learning plugin.
 */

// =========================================================================
// Memory Backend — abstraction over OpenViking, file-based, or future backends
// =========================================================================

export type FindResultItem = {
  uri: string;
  level?: number;
  abstract?: string;
  category?: string;
  score?: number;
};

export type FindResult = {
  memories?: FindResultItem[];
  resources?: FindResultItem[];
  skills?: FindResultItem[];
  total?: number;
};

export interface MemoryBackend {
  readonly type: string;
  healthCheck(): Promise<boolean>;
  find(
    query: string,
    options: { targetUri: string; limit: number; scoreThreshold?: number },
    agentId?: string,
  ): Promise<FindResult>;
  read(uri: string, agentId?: string): Promise<string>;
  writeFile(uri: string, content: string, agentId?: string): Promise<void>;
  deleteUri(uri: string, agentId?: string): Promise<void>;
  trackRecall(uris: string[]): Promise<void>;
}

// =========================================================================
// Plugin types
// =========================================================================

// Per-tool accumulator during a single agent run
export type ToolCallAccumulator = {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  lastError?: string;
};

// Accumulated stats for one agent run
export type RunToolStats = {
  runId: string;
  sessionKey: string;
  agentId: string;
  toolCalls: Map<string, ToolCallAccumulator>;
  startedAt: number;
};

// Security scan finding
export type Finding = {
  patternId: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "exfiltration" | "injection" | "destructive" | "persistence" | "obfuscation";
  line: number;
  match: string;
  description: string;
};

// Security scan result
export type ScanResult = {
  verdict: "safe" | "caution" | "dangerous";
  findings: Finding[];
};

// Trajectory entry (one JSONL line)
export type TrajectoryEntry = {
  ts: number;
  type: "llm_input" | "llm_output" | "tool_call" | "tool_result";
  runId: string;
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
};

// Minimal plugin API types (subset of OpenClawPluginApi)
export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type HookAgentContext = {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
};
