/**
 * useGeminiStream — Ani daemon adapter
 *
 * Routes all streaming calls to Ani's DaemonClient instead of the Gemini API.
 * The return interface is identical to the original useGeminiStream hook.
 */
export { useAniStream as useGeminiStream } from '../../shim/hooks/useAniStream.js';
