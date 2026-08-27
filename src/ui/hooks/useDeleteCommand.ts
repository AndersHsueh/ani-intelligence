/**
 * /delete 会话删除 hook（W5，融合自 qwen-code useDeleteCommand.ts）
 *
 * alice 差异：删除走 DaemonClient（HTTP DELETE /session/:id），
 * 防删当前会话以 config.getSessionId() 为准。
 */

import { useState, useCallback } from 'react';
import type { Config } from '@qwen-code/qwen-code-core';
import { daemonClient } from '../../utils/daemonClientInstance.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

export interface UseDeleteCommandOptions {
  config: Config | null;
  addItem: UseHistoryManagerReturn['addItem'];
}

export interface UseDeleteCommandResult {
  isDeleteDialogOpen: boolean;
  openDeleteDialog: () => void;
  closeDeleteDialog: () => void;
  handleDelete: (sessionId: string) => void;
}

export function useDeleteCommand(
  options?: UseDeleteCommandOptions,
): UseDeleteCommandResult {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const openDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(false);
  }, []);

  const { config, addItem } = options ?? {};

  const handleDelete = useCallback(
    async (sessionId: string) => {
      if (!config) {
        return;
      }

      // Close dialog immediately.
      closeDeleteDialog();

      // Prevent deleting the current session.
      if (sessionId === config.getSessionId()) {
        addItem?.(
          {
            type: 'info',
            text: 'Cannot delete the current active session.',
          },
          Date.now(),
        );
        return;
      }

      try {
        const success = await daemonClient.deleteSession(sessionId);

        if (success) {
          addItem?.(
            {
              type: 'info',
              text: 'Session deleted successfully.',
            },
            Date.now(),
          );
        } else {
          addItem?.(
            {
              type: 'error',
              text: 'Failed to delete session. Session not found.',
            },
            Date.now(),
          );
        }
      } catch {
        addItem?.(
          {
            type: 'error',
            text: 'Failed to delete session.',
          },
          Date.now(),
        );
      }
    },
    [closeDeleteDialog, config, addItem],
  );

  return {
    isDeleteDialogOpen,
    openDeleteDialog,
    closeDeleteDialog,
    handleDelete,
  };
}
