/**
 * Extract user-visible text from provider responses.
 *
 * Providers in the OpenAI-compatible family normally return a string, while
 * Anthropic/MiniMax responses may expose text blocks under `content`. Keep the
 * boundary explicit so callers never accidentally turn a response object into
 * "[object Object]".
 */
export function extractTextContent(value: unknown): string {
  return extractTextContentInternal(value, new Set<object>());
}

function extractTextContentInternal(value: unknown, seen: Set<object>): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextContentInternal(item, seen))
      .filter(Boolean)
      .join('');
  }
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  const record = value as Record<string, unknown>;
  // Ordered from the most direct text representation to common API wrappers.
  for (const key of ['text', 'content', 'output_text', 'message', 'delta', 'choices']) {
    if (!(key in record)) continue;
    const text = extractTextContentInternal(record[key], seen);
    if (text) return text;
  }
  return '';
}
