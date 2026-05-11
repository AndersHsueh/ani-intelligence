import path from 'path';
import type { ToolExecutionContext } from '../types/tool.js';

export function resolveFromContext(filePath: string, context?: ToolExecutionContext): string {
  const base = context?.workspace ?? process.cwd();
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);
}
