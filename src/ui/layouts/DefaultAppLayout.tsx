/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { MainContent } from '../components/MainContent.js';
import { DialogManager } from '../components/DialogManager.js';
import { Composer } from '../components/Composer.js';
import { ExitWarning } from '../components/ExitWarning.js';
import { StickyTodoList } from '../components/StickyTodoList.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { StreamingState } from '../types.js';
import { getStickyTodoMaxVisibleItems } from '../utils/todoSnapshot.js';

export const DefaultAppLayout: React.FC = () => {
  const uiState = useUIState();
  const { columns: terminalWidth } = useTerminalSize();

  // Sticky todo panel (fused from qwen-code DefaultAppLayout.tsx). alice
  // adaptation: no agent-tab view / BtwMessage here; the panel is mounted in
  // the main view only, and uiState.stickyTodos is null unless the
  // `general.stickyTodos` setting is enabled.
  const stickyTodoWidth = Math.min(uiState.mainAreaWidth, 64);
  const stickyTodoMaxVisibleItems = getStickyTodoMaxVisibleItems(
    uiState.terminalHeight,
  );
  const shouldShowStickyTodos =
    uiState.stickyTodos !== null &&
    !uiState.dialogsVisible &&
    !uiState.isFeedbackDialogOpen &&
    uiState.streamingState !== StreamingState.WaitingForConfirmation;

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <MainContent />

      <Box flexDirection="column" ref={uiState.mainControlsRef}>
        {uiState.dialogsVisible ? (
          <Box marginX={2} flexDirection="column" width={uiState.mainAreaWidth}>
            <DialogManager
              terminalWidth={uiState.terminalWidth}
              addItem={uiState.historyManager.addItem}
            />
          </Box>
        ) : (
          <>
            {shouldShowStickyTodos && (
              <StickyTodoList
                todos={uiState.stickyTodos!}
                width={stickyTodoWidth}
                maxVisibleItems={stickyTodoMaxVisibleItems}
              />
            )}
            <Composer />
          </>
        )}

        <ExitWarning />
      </Box>
    </Box>
  );
};
