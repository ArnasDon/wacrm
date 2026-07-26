// ============================================================
// Tool registration — decides which tools exist for this process
// based on the write guards. Reads are always on; writes and
// broadcasts are opt-in (see config.ts).
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import type { Config } from '../config.js';
import { registerReadTools } from './read.js';
import { registerWriteTools } from './write.js';
import { registerBroadcastTools } from './broadcast.js';

export function registerTools(server: McpServer, client: WacrmClient, config: Config): string[] {
  const enabled: string[] = ['read'];
  registerReadTools(server, client);

  if (config.enableWrites) {
    registerWriteTools(server, client);
    enabled.push('write');
  }

  if (config.enableBroadcasts) {
    registerBroadcastTools(server, client);
    enabled.push('broadcast');
  }

  return enabled;
}
