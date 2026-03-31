/**
 * Trajectory writer service — periodically flushes captured entries to JSONL.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginLogger } from "../types.js";
import { drainBuffer, getBufferSize } from "../hooks/trajectory-capture.js";

const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const FLUSH_THRESHOLD = 50;

export function createTrajectoryWriterService(
  trajectoryDir: string,
  logger: PluginLogger,
) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function flush(): void {
    const entries = drainBuffer();
    if (entries.length === 0) return;

    // Ensure directory exists
    if (!existsSync(trajectoryDir)) {
      mkdirSync(trajectoryDir, { recursive: true });
    }

    // Write to date-partitioned file
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(trajectoryDir, `trajectory-${date}.jsonl`);

    try {
      const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      appendFileSync(filePath, lines, "utf-8");
    } catch (err) {
      logger.warn(`self-learning: trajectory write failed: ${err}`);
    }
  }

  return {
    id: "self-learning-trajectory",
    start: () => {
      logger.info(`self-learning: trajectory writer started (dir: ${trajectoryDir})`);
      timer = setInterval(() => {
        if (getBufferSize() >= FLUSH_THRESHOLD) {
          flush();
        }
      }, FLUSH_INTERVAL_MS);

      // Also flush on interval regardless of threshold
      const periodicTimer = setInterval(flush, FLUSH_INTERVAL_MS);

      // Store both for cleanup
      const originalTimer = timer;
      timer = periodicTimer;

      return () => {
        clearInterval(originalTimer);
        clearInterval(periodicTimer);
      };
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Final flush on stop
      flush();
      logger.info("self-learning: trajectory writer stopped");
    },
  };
}
