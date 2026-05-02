/**
 * Minimal DaemonClient stub for Ani (single process - no daemon).
 * Keeps the TUI compatibility without requiring an external daemon process.
 */
export class DaemonClient {
  async getConfig(): Promise<any> {
    return { default_model: '', workspace: process.cwd() };
  }

  async getMode(): Promise<'office' | 'coder'> {
    return 'coder';
  }

  async getStatus(): Promise<any> {
    return null;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async createSession(): Promise<{ id: string }> {
    return { id: `ani-${Date.now()}` };
  }

  async getSession(): Promise<any> {
    return { id: `ani-${Date.now()}`, messages: [] };
  }

  chatStream(_payload: any): AsyncGenerator<any> {
    return (async function* () {} )();
  }
}
