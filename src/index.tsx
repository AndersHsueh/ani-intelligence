#!/usr/bin/env bun
/**
 * Ani - Minimalist terminal AI assistant
 * Single-process, no daemon.
 */
import React from 'react';
// @ts-ignore
import { render } from 'ink';
import { configManager } from './aniConfig.js';

async function startTUI(): Promise<void> {
  const { Config } = await import('./shim/qwen-code-core.js');
  const { AppContainer } = await import('./ui/AppContainer.js');
  const { KeypressProvider } = await import('./ui/contexts/KeypressContext.js');
  const { SessionStatsProvider } = await import('./ui/contexts/SessionContext.js');
  const { VimModeProvider } = await import('./ui/contexts/VimModeContext.js');
  const { useKittyKeyboardProtocol } = await import('./ui/hooks/useKittyKeyboardProtocol.js');

  const { SettingsContext } = await import('./ui/contexts/SettingsContext.js');

  const { createMinimalSettings } = await import('./config/settings.js');

  configManager.init();
  const aniConfig = configManager.get();

  const config = new Config({
    model: aniConfig.default_model,
    workingDir: process.cwd(),
    targetDir: process.cwd(),
  });

  const settings = createMinimalSettings();
  const initializationResult = {
    authError: null,
    themeError: null,
    shouldOpenAuthDialog: false,
    geminiMdFileCount: 0,
  };

  const AppWrapper = () => {
    const kittyProtocolStatus = useKittyKeyboardProtocol();
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10);
    return (
      <SettingsContext.Provider value={settings}>
      <KeypressProvider
        kittyProtocolEnabled={kittyProtocolStatus.enabled}
        config={config}
        debugKeystrokeLogging={false}
        pasteWorkaround={process.platform === 'win32' || nodeMajorVersion < 20}
      >
        <SessionStatsProvider sessionId=''>
          <VimModeProvider settings={settings}>
            <AppContainer
              config={config}
              settings={settings}
              startupWarnings={[]}
              version="0.1.0"
              initializationResult={initializationResult}
            />
          </VimModeProvider>
        </SessionStatsProvider>
      </KeypressProvider>
      </SettingsContext.Provider>
    );
  };

  // @ts-ignore
  const instance = render(<AppWrapper />, {
    exitOnCtrlC: false,
    isScreenReaderEnabled: false,
  });

  process.once('SIGINT', () => {
    instance.unmount();
    process.exit(0);
  });
}

startTUI().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
