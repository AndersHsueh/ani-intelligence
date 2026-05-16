# Incorrectly-implemented Slash Commands

The following slash commands have test failures due to incomplete mocks or incorrect assumptions.

## Commands Needing Fix

### 1. `extensionsCommand`
**File**: `src/ui/commands/extensionsCommand.ts`
**Issue**: `context.ui.addItem is not a function`
**Root Cause**: The mock `CommandContext` doesn't include all methods called by `installAction`

### 2. `mcpCommand`
**File**: `src/ui/commands/mcpCommand.ts`
**Issue**: Dialog function mock problems
**Root Cause**: Tests don't properly mock the dialog opening functions

### 3. `memoryCommand`
**File**: `src/ui/commands/memoryCommand.ts`
**Issue**: Tests expect `AGENTS.md` but shim now uses `agent.md` (via `getCurrentGeminiMdFilename()`)
**Root Cause**: Test expectations hardcode old filename `AGENTS.md`
```
Expected: "/test/project/AGENTS.md"
Actual:   "/test/project/agent.md"
```

### 4. `approvalModeCommand`
**File**: `src/ui/commands/approvalModeCommand.ts`
**Issue**: Test expects 'info' but gets 'error'
**Root Cause**: Mock context returns wrong approval mode value

### 5. `exportCommand`
**File**: `src/ui/commands/exportCommand.ts`
**Issue**: HTML export test failure
**Root Cause**: Session history mock incomplete

## How to Fix

The general pattern for fixing these:

1. Ensure `createMockCommandContext()` includes all `ui` methods used by the command
2. Update hardcoded filenames to use `getCurrentGeminiMdFilename()` dynamically
3. For dialog tests, mock the dialog-opening functions properly

## Example Fix Pattern

```typescript
// Instead of hardcoding:
const expectedPath = '/test/project/AGENTS.md';

// Use dynamic import:
import { getCurrentGeminiMdFilename } from '@qwen-code/qwen-code-core';
const expectedPath = path.join('/test/project', getCurrentGeminiMdFilename());
```

## Mock Context Update

Add these methods to `src/test-utils/mockCommandContext.ts` if missing:

```typescript
ui: {
  addItem: vi.fn(),
  clear: vi.fn(),
  setDebugMessage: vi.fn(),
  pendingItem: null,
  setPendingItem: vi.fn(),
  loadHistory: vi.fn(),
  toggleVimEnabled: vi.fn().mockResolvedValue(false),
  setGeminiMdFileCount: vi.fn(),
  reloadCommands: vi.fn(),
  extensionsUpdateState: new Map(),
  dispatchExtensionStateUpdate: vi.fn(),
  addConfirmUpdateExtensionRequest: vi.fn(),
  // Add missing methods here
}
```