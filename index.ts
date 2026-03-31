/**
 * Hermes Learning Plugin for OpenClaw
 *
 * Self-improving skills, cross-agent memory bridge, structured compression,
 * and trajectory capture — ported from Hermes Agent's self-learning mechanisms.
 *
 * Phases:
 *   1. Self-Improving Skills (skill_create, skill_patch, skill_list + auto-review)
 *   2A. Cross-Agent Episode Bridge (cross_agent_recall + Zenith context injection)
 *   3. Structured Context Compression (before_compaction template)
 *   4. Trajectory Capture (JSONL logging for future fine-tuning)
 *
 * Memory backend is pluggable — set memoryBackendType to "openviking" or "none".
 * Phases 1, 3, 4 work without any memory backend.
 * Phase 2A requires a memory backend for cross-agent search.
 */

import type { MemoryBackend } from "./types.js";
import { parseConfig } from "./config.js";
import { VikingClient } from "./viking-client.js";

// Phase 1: Tools
import { createSkillCreateTool } from "./tools/skill-create.js";
import { createSkillPatchTool } from "./tools/skill-patch.js";
import { createSkillListTool } from "./tools/skill-list.js";

// Phase 1: Hooks
import { createToolStatsHandler } from "./hooks/tool-stats-tracker.js";
import { createSkillReviewerHandler } from "./hooks/skill-reviewer.js";

// Phase 2A: Cross-Agent
import { createCrossAgentRecallTool } from "./tools/cross-agent-recall.js";
import { createZenithContextHandler } from "./hooks/zenith-context.js";

// Phase 3: Compression
import { createCompactionTemplateHandler } from "./hooks/compaction-template.js";

// Phase 4: Trajectory
import {
  createLlmInputHandler,
  createLlmOutputHandler,
  createToolCallTrajectoryHandler,
} from "./hooks/trajectory-capture.js";
import { createTrajectoryWriterService } from "./services/trajectory-writer.js";

type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type HookAgentContext = {
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
};

type OpenClawPluginApi = {
  id?: string;
  pluginConfig?: unknown;
  logger: PluginLogger;
  runtime: {
    subagent?: {
      run: (params: {
        sessionKey: string;
        message: string;
        extraSystemPrompt?: string;
        deliver?: boolean;
      }) => Promise<unknown>;
    };
  };
  registerTool: (
    tool: {
      name: string;
      label: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
    },
    opts?: { name?: string },
  ) => void;
  registerService: (service: {
    id: string;
    start: () => void | Promise<void> | (() => void);
    stop?: () => void | Promise<void>;
  }) => void;
  on: (
    hookName: string,
    handler: (event: unknown, ctx?: HookAgentContext) => unknown,
    opts?: { priority?: number },
  ) => void;
};

/**
 * Create a memory backend based on config, or return null if type is "none".
 */
function createMemoryBackend(cfg: ReturnType<typeof parseConfig>, logger: PluginLogger): MemoryBackend | null {
  if (cfg.memoryBackendType === "none") return null;

  try {
    if (cfg.memoryBackendType === "openviking") {
      return new VikingClient(
        cfg.memoryBackendUrl,
        cfg.memoryBackendApiKey,
        "self-learning",
        cfg.memoryBackendTimeoutMs,
      );
    }
    logger.warn(`self-learning: unknown memoryBackendType "${cfg.memoryBackendType}", disabling memory backend`);
    return null;
  } catch (err) {
    logger.warn(`self-learning: memory backend init failed: ${err}`);
    return null;
  }
}

const hermesLearningPlugin = {
  id: "self-learning",
  name: "Hermes Learning",
  description: "Self-improving skills, cross-agent memory bridge, structured compression, and trajectory capture",

  register(api: OpenClawPluginApi) {
    const logger = api.logger;
    const cfg = parseConfig(api.pluginConfig);
    const backend = createMemoryBackend(cfg, logger);

    // =========================================================================
    // Phase 1: Self-Improving Skills
    // =========================================================================

    api.registerTool(createSkillCreateTool(cfg.skillsDir));
    api.registerTool(createSkillPatchTool(cfg.skillsDir));
    api.registerTool(createSkillListTool(cfg.skillsDir));

    if (cfg.enableToolStats) {
      api.on("after_tool_call", createToolStatsHandler(logger) as never, { priority: 100 });
    }

    if (cfg.enableToolStats || cfg.enableSkillReview) {
      api.on(
        "agent_end",
        createSkillReviewerHandler(
          cfg,
          backend,
          logger,
          api.runtime.subagent,
        ) as never,
        { priority: 50 },
      );
    }

    logger.info(
      `self-learning: Phase 1 active — skills dir: ${cfg.skillsDir}, ` +
      `review threshold: ${cfg.skillReviewThreshold} tool calls`,
    );

    // =========================================================================
    // Phase 2A: Cross-Agent Episode Bridge
    // =========================================================================

    if (cfg.enableCrossAgentRecall && backend) {
      api.registerTool(createCrossAgentRecallTool(cfg, backend, logger));
      api.on(
        "before_prompt_build",
        createZenithContextHandler(cfg, backend, logger) as never,
        { priority: 50 },
      );
      logger.info(
        `self-learning: Phase 2A active — cross-agent recall via ${backend.type} for ${cfg.crossAgentScopes.length} agents`,
      );
    }

    // =========================================================================
    // Phase 3: Structured Context Compression
    // =========================================================================

    if (cfg.enableCompaction) {
      api.on(
        "before_compaction",
        createCompactionTemplateHandler(cfg) as never,
        { priority: 10 },
      );
      logger.info("self-learning: Phase 3 active — structured compaction template");
    }

    // =========================================================================
    // Phase 4: Trajectory Capture
    // =========================================================================

    if (cfg.enableTrajectory) {
      api.on("llm_input", createLlmInputHandler() as never, { priority: 100 });
      api.on("llm_output", createLlmOutputHandler() as never, { priority: 100 });
      api.on("after_tool_call", createToolCallTrajectoryHandler() as never, { priority: 101 });

      api.registerService(createTrajectoryWriterService(cfg.trajectoryDir, logger));

      logger.info(`self-learning: Phase 4 active — trajectory capture to ${cfg.trajectoryDir}`);
    }

    const backendStatus = backend ? `${backend.type} at ${cfg.memoryBackendUrl}` : "none (local-only mode)";
    logger.info(`self-learning: plugin registered — memory backend: ${backendStatus}`);
  },
};

export default hermesLearningPlugin;
