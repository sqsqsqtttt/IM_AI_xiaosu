import type { ToolCallRecord, ToolDefinition } from '../types.ts';

/** 统一工具执行结果。 */
export interface ToolExecResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolRegistry {
  defs: ToolDefinition[];
  execute(name: string, args: unknown): Promise<ToolExecResult>;
}

/** 已执行工具日志视图（管理后台展示）。 */
export type { ToolCallRecord };
