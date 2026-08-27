/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import process from 'node:process';
import { StreamingState } from '../types.js';
import {
  notifyTerminalAttention,
  AttentionNotificationReason,
} from '../../utils/attentionNotification.js';
import { buildTerminalNotification } from './useTerminalNotification.js';
import { detectTerminal, generateKittyId } from '../utils/osc.js';
import type { LoadedSettings } from '../../config/settings.js';

export const LONG_TASK_NOTIFICATION_THRESHOLD_SECONDS = 20;

const NOTIFICATION_TITLE = 'Alice Code';

interface UseAttentionNotificationsOptions {
  isFocused: boolean;
  streamingState: StreamingState;
  elapsedTime: number;
  settings: LoadedSettings;
}

/**
 * Fused from qwen-code notificationService routing: when the terminal
 * supports a native notification protocol (iTerm2 OSC 9 / Kitty OSC 99 /
 * Ghostty OSC 777), send a titled desktop notification; otherwise return
 * false so the caller falls back to the legacy terminal bell behavior.
 */
function sendProtocolNotification(message: string): boolean {
  // Don't write raw escape sequences when stdout is not a TTY
  // (CI, piped output, redirected to log files, etc.)
  if (!process.stdout?.isTTY) {
    return false;
  }

  const terminal = buildTerminalNotification((seq) => {
    process.stdout.write(seq);
  });

  try {
    switch (detectTerminal()) {
      case 'iTerm.app':
        terminal.notifyITerm2({ message, title: NOTIFICATION_TITLE });
        return true;
      case 'kitty':
        terminal.notifyKitty({
          message,
          title: NOTIFICATION_TITLE,
          id: generateKittyId(),
        });
        return true;
      case 'ghostty':
        terminal.notifyGhostty({ message, title: NOTIFICATION_TITLE });
        return true;
      default:
        return false;
    }
  } catch {
    // Escape-sequence failures must never break the UI; fall back to bell.
    return false;
  }
}

export const useAttentionNotifications = ({
  isFocused,
  streamingState,
  elapsedTime,
  settings,
}: UseAttentionNotificationsOptions) => {
  const terminalBellEnabled = settings?.merged?.general?.terminalBell ?? true;
  const awaitingNotificationSentRef = useRef(false);
  const respondingElapsedRef = useRef(0);

  useEffect(() => {
    if (
      streamingState === StreamingState.WaitingForConfirmation &&
      !isFocused &&
      !awaitingNotificationSentRef.current
    ) {
      // Protocol notification first (titled desktop notification on
      // iTerm2/Kitty/Ghostty); fall back to the original bell behavior.
      if (!sendProtocolNotification('Alice Code is waiting for your input')) {
        notifyTerminalAttention(AttentionNotificationReason.ToolApproval, {
          enabled: terminalBellEnabled,
        });
      }
      awaitingNotificationSentRef.current = true;
    }

    if (streamingState !== StreamingState.WaitingForConfirmation || isFocused) {
      awaitingNotificationSentRef.current = false;
    }
  }, [isFocused, streamingState, terminalBellEnabled]);

  useEffect(() => {
    if (streamingState === StreamingState.Responding) {
      respondingElapsedRef.current = elapsedTime;
      return;
    }

    if (streamingState === StreamingState.Idle) {
      const wasLongTask =
        respondingElapsedRef.current >=
        LONG_TASK_NOTIFICATION_THRESHOLD_SECONDS;
      if (wasLongTask && !isFocused) {
        // Protocol notification first; fall back to the original bell.
        if (
          !sendProtocolNotification('Alice Code is waiting for your input')
        ) {
          notifyTerminalAttention(AttentionNotificationReason.LongTaskComplete, {
            enabled: terminalBellEnabled,
          });
        }
      }
      // Reset tracking for next task
      respondingElapsedRef.current = 0;
      return;
    }
  }, [streamingState, elapsedTime, isFocused, terminalBellEnabled]);
};
