/**
 * useAliceStream - Ani's single-process LLM stream hook.
 * Connects the qwen-code TUI to Ani's local LLMClient (no daemon).
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ThoughtSummary, Config } from '../qwen-code-core.js';
import { getErrorMessage } from '../qwen-code-core.js';
import {
  StreamingState,
  ToolCallStatus,
  type HistoryItem,
  type HistoryItemWithoutId,
  type IndividualToolCallDisplay,
} from '../../ui/types.js';
import type { UseHistoryManagerReturn } from '../../ui/hooks/useHistoryManager.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { SlashCommandProcessorResult } from '../../ui/types.js';
import { LLMClient, type StreamEvent } from '../../core/llm.js';
import { configManager } from '../../aniConfig.js';
import { createSession, getSession, addMessage, getMessages, setMessages } from '../../session.js';
import { detectStartupMode, getSystemPromptPath } from '../../onboarding/index.js';
import { InboxWatcher, type InboxSignal } from '../../ani/inboxWatcher.js';
import { isAtCommand } from '../../ui/utils/commandUtils.js';
import { expandAtCommands } from '../atExpander.js';
import * as path from 'node:path';

interface TrackedToolCall {
  callId: string;
  toolName: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  resultDisplay?: string;
}

function isSlashCommandQuery(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('?');
}

export const useAliceStream = (
  _geminiClient: any,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  _settings: any,
  _onDebugMessage: (msg: string) => void,
  _handleSlashCommand: (cmd: any) => Promise<any>,
  _shellModeActive: boolean,
  _getPreferredEditor: () => any,
  _onAuthError: (err: string) => void,
  _performMemoryRefresh: () => Promise<void>,
  _modelSwitchedFromQuotaError: boolean,
  _setModelSwitchedFromQuotaError: (v: boolean) => void,
  _onEditorClose: () => void,
  _onCancelSubmit: () => void,
  _setShellInputFocused: (v: boolean) => void,
  _terminalWidth: number,
  _terminalHeight: number,
) => {
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [initError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [toolCalls, setToolCalls] = useState<TrackedToolCall[]>([]);
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const [modelDegraded, setModelDegraded] = useState(false);
  const [activeModelName, setActiveModelName] = useState<string | undefined>(undefined);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string>('');
  const pendingTextRef = useRef('');
  const pendingItemIdRef = useRef<number | null>(null);
  const toolGroupIdRef = useRef<number | null>(null);
  const onboardingTriggeredRef = useRef(false);

  const cancelOngoingRequest = useCallback(() => {
    if (streamingState === StreamingState.Responding) {
      abortControllerRef.current?.abort();
    }
  }, [streamingState]);

  const submitQuery = useCallback(async (text: string | any) => {
    const prompt = typeof text === 'string' ? text : String(text);
    if (!prompt.trim()) return;
    if (streamingState === StreamingState.Responding) return;

    if (isSlashCommandQuery(prompt)) {
      const slashResult = await _handleSlashCommand(
        prompt.trim(),
      ) as SlashCommandProcessorResult | false;
      if (slashResult) {
        if (slashResult.type === 'submit_prompt') {
          await submitQuery(
            typeof slashResult.content === 'string'
              ? slashResult.content
              : String(slashResult.content),
          );
        }
        return;
      }
    }

    lastPromptRef.current = prompt;
    setUserMessages(prev => [...prev, prompt]);

    const timestamp = Date.now();
    addItem({ type: 'user', text: prompt } as Omit<HistoryItem, 'id'>, timestamp);

    setPendingText('');
    pendingTextRef.current = '';
    pendingItemIdRef.current = null;
    toolGroupIdRef.current = null;
    setToolCalls([]);
    setThought(null);
    setStreamingState(StreamingState.Responding);

    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const workspace = process.cwd();
      const modelConfig = configManager.getDefaultModel();
      if (!modelConfig) {
        addItem({ type: 'error', text: 'Error: No model configured' } as Omit<HistoryItem, 'id'>, Date.now());
        setStreamingState(StreamingState.Idle);
        return;
      }

      // Create session once per app lifetime
      if (!getSession()) createSession(workspace);

      // UI shows the user's original prompt; the LLM sees the @-expanded version.
      let promptForLLM = prompt;
      if (isAtCommand(prompt)) {
        try {
          const { expandedPrompt, readPaths } = await expandAtCommands(prompt, workspace);
          promptForLLM = expandedPrompt;
          if (readPaths.length > 0) {
            const toolDisplays: IndividualToolCallDisplay[] = readPaths.map((p, idx) => ({
              callId: `at-read-${timestamp}-${idx}`,
              name: 'Read File',
              description: `Read ${path.relative(workspace, p) || p}`,
              status: ToolCallStatus.Success,
              resultDisplay: undefined,
              confirmationDetails: undefined,
            }));
            addItem(
              { type: 'tool_group', tools: toolDisplays } as Omit<HistoryItem, 'id'>,
              timestamp,
            );
          }
        } catch (e: unknown) {
          addItem(
            { type: 'info', text: `@ expansion failed: ${getErrorMessage(e)}` } as Omit<HistoryItem, 'id'>,
            timestamp,
          );
        }
      }

      addMessage({ role: 'user', content: promptForLLM, timestamp: new Date() });

      // Detect onboarding mode
      const mode = detectStartupMode();
      const systemPromptPath = getSystemPromptPath(mode);

      const client = new LLMClient(modelConfig, { systemPromptPath });
      const messages = getMessages();

      for await (const event of client.chatStream(messages, workspace)) {
        if (ac.signal.aborted) break;
        handleStreamEvent(event, timestamp, addItem);
      }
    } catch (err: any) {
      if (!ac.signal.aborted) {
        const errMsg = err?.message || String(err);
        addItem({ type: 'error', text: `Error: ${errMsg}` } as Omit<HistoryItem, 'id'>, Date.now());
      }
    } finally {
      setStreamingState(StreamingState.Idle);
    }
  }, [streamingState, config, addItem, _handleSlashCommand]);

  const handleStreamEvent = useCallback((
    event: StreamEvent,
    _baseTimestamp: number,
    addItemFn: UseHistoryManagerReturn['addItem'],
  ) => {
    if (event.type === 'text' && event.content) {
      const newText = pendingTextRef.current + event.content;
      pendingTextRef.current = newText;
      setPendingText(newText);
    } else if (event.type === 'tool_call' && event.record) {
      const record = event.record;
      const callId = record.id;
      const status = record.status === 'success'
        ? ToolCallStatus.Success
        : record.status === 'error'
          ? ToolCallStatus.Error
          : record.status === 'running'
            ? ToolCallStatus.Executing
            : ToolCallStatus.Pending;

      const toolDisplay: IndividualToolCallDisplay = {
        callId,
        name: record.toolName,
        description: `${record.toolName}(${JSON.stringify(record.params || {}).slice(0, 100)})`,
        status,
        resultDisplay: record.result ? JSON.stringify(record.result.data || record.result.error || '').slice(0, 200) : '',
        confirmationDetails: undefined,
        renderOutputAsMarkdown: false,
      };

      setToolCalls(prev => {
        const existingIdx = prev.findIndex(t => t.callId === callId);
        const updated: TrackedToolCall = {
          callId,
          toolName: record.toolName,
          status,
          args: record.params,
          resultDisplay: toolDisplay.resultDisplay,
        };
        if (existingIdx >= 0) {
          const arr = [...prev];
          arr[existingIdx] = updated;
          return arr;
        }
        return [...prev, updated];
      });

      // Add tool group to history
      if (toolGroupIdRef.current !== null) {
        // Tool group already exists for this conversation turn
      } else {
        const id = addItemFn(
          { type: 'tool_group', tools: [toolDisplay] } as Omit<HistoryItem, 'id'>,
          Date.now(),
        );
        toolGroupIdRef.current = id;
      }
    } else if (event.type === 'done') {
      // Sync full conversation (user + tool interactions + assistant) back to session
      if (event.conversation) {
        setMessages(event.conversation);
      }
      const finalText = pendingTextRef.current;
      if (finalText) {
        addItemFn(
          { type: 'gemini', text: finalText } as Omit<HistoryItem, 'id'>,
          Date.now(),
        );
        pendingTextRef.current = '';
        setPendingText('');
      }
      toolGroupIdRef.current = null;
    } else if (event.type === 'error') {
      addItemFn(
        { type: 'error', text: event.message || 'Unknown error' } as Omit<HistoryItem, 'id'>,
        Date.now(),
      );
    }
  }, []);

  const retryLastPrompt = useCallback(async () => {
    if (streamingState !== StreamingState.Idle) return;
    const last = lastPromptRef.current;
    if (last) await submitQuery(last);
  }, [streamingState, submitQuery]);

  const handleApprovalModeChange = useCallback((_mode: any) => {}, []);

  // Auto-trigger onboarding on first mount if no user profile exists
  useEffect(() => {
    if (onboardingTriggeredRef.current) return;
    if (streamingState !== StreamingState.Idle) return;
    const mode = detectStartupMode();
    if (mode === 'onboarding') {
      onboardingTriggeredRef.current = true;
      submitQuery('你好');
    }
  }, [streamingState, submitQuery]);

  // Initialize InboxWatcher — listen for task completion/failure signals
  useEffect(() => {
    const watcher = new InboxWatcher();
    watcher.start((signal: InboxSignal) => {
      if (signal.status === 'done') {
        addItem(
          { type: 'info', text: `[系统提示：后台任务已完成，结果在 ~/.ani/tasks/${signal.taskId}/subtasks/ 下]` } as Omit<HistoryItem, 'id'>,
          Date.now(),
        );
      } else {
        addItem(
          { type: 'error', text: `[系统提示：后台任务失败，原因：${signal.message ?? '未知'}，请告知用户]` } as Omit<HistoryItem, 'id'>,
          Date.now(),
        );
      }
    });
    return () => { watcher.stop(); };
  }, [addItem]);

  const pendingHistoryItems = useMemo((): HistoryItemWithoutId[] => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingText) {
      items.push({ type: 'gemini', text: pendingText } as HistoryItemWithoutId);
    }
    return items;
  }, [pendingText]);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
    retryLastPrompt,
    pendingToolCalls: toolCalls,
    handleApprovalModeChange,
    activePtyId: undefined as number | undefined,
    loopDetectionConfirmationRequest: null,
    modelDegraded,
    activeModelName,
  };
};
