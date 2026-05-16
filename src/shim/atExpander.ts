/**
 * Parses `@<path>` tokens out of a prompt and expands them into file contents.
 * Reuses readManyFiles for the actual disk I/O.
 */

import { readManyFiles } from './qwen-code-core.js';

export interface ExpandedAtCommand {
  expandedPrompt: string;
  readPaths: string[];
}

const PATH_TERMINATORS = /[\s,;!?()[\]{}]/;

function extractAtPaths(query: string): string[] {
  const paths: string[] = [];
  let i = 0;
  while (i < query.length) {
    const atIdx = query.indexOf('@', i);
    if (atIdx === -1) break;
    // Only count as a reference if preceded by whitespace or at start
    // (so `email@example.com` isn't picked up).
    if (atIdx > 0 && !/\s/.test(query[atIdx - 1])) {
      i = atIdx + 1;
      continue;
    }
    let end = atIdx + 1;
    while (end < query.length) {
      const ch = query[end];
      if (PATH_TERMINATORS.test(ch)) break;
      if (ch === '.') {
        const next = query[end + 1] ?? '';
        if (next === '' || /\s/.test(next)) break;
      }
      end++;
    }
    const p = query.slice(atIdx + 1, end);
    if (p.length > 0) paths.push(p);
    i = end;
  }
  return paths;
}

export async function expandAtCommands(
  query: string,
  workspace: string,
): Promise<ExpandedAtCommand> {
  const atPaths = extractAtPaths(query);
  if (atPaths.length === 0) {
    return { expandedPrompt: query, readPaths: [] };
  }

  const { contentParts, files } = await readManyFiles(workspace, { paths: atPaths });
  if (files.length === 0) {
    return { expandedPrompt: query, readPaths: [] };
  }

  const contextBlock = contentParts
    .map((p) => (typeof p === 'string' ? p : p.text ?? ''))
    .join('');

  return {
    expandedPrompt: `${query}\n\n${contextBlock}`,
    readPaths: files.map((f) => f.filePath),
  };
}
