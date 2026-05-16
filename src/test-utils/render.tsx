/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render as inkRender, type RenderOptions } from 'ink';
import React from 'react';
import type { ComponentType, ReactNode } from 'react';

interface RenderResult {
  /** Returns the current rendered output */
  lastFrame: () => string | undefined;
  /** Cleanup the render tree */
  unmount: () => void;
}

/**
 * Renders a React component with Ink and returns the render result.
 * This is a simplified replacement for ink-testing-library.
 */
export function renderWithProviders(
  element: ReactNode,
  _options: { settings?: unknown; config?: unknown } = {},
): RenderResult {
  let result: RenderResult;

  inkRender(element, {
    exitOnNextTick: false,
    patchConsole: false,
  } as RenderOptions).once(
    'root',
    (r) => {
      result = {
        lastFrame: () => r.lastFrame ?? undefined,
        unmount: () => r.unmount(),
      };
    },
  );

  if (!result) {
    return {
      lastFrame: () => '',
      unmount: () => {},
    };
  }

  return {
    lastFrame: () => result!.lastFrame() ?? '',
    unmount: () => result!.unmount(),
  };
}

export { render as inkRender };