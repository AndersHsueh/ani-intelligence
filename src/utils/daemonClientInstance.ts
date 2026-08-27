/**
 * DaemonClient 共享实例。
 *
 * UI 层的多个命令（/rename、/delete 等）需要访问 daemon API。
 * 与 AppContainer/AppHeader 各自 new DaemonClient() 的模式相比，
 * 此单例避免每个命令重复建立连接配置，也便于测试替换。
 */

import { DaemonClient } from './daemonClient.js';

let instance: DaemonClient | null = null;

export function getDaemonClient(): DaemonClient {
  if (!instance) {
    instance = new DaemonClient();
  }
  return instance;
}

/** 测试或特殊场景下替换/清空共享实例。 */
export function setDaemonClient(client: DaemonClient | null): void {
  instance = client;
}

export const daemonClient: DaemonClient = getDaemonClient();
