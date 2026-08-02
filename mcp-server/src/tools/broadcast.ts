// ============================================================
// Broadcast tool — the highest-risk action.
//
// Registered only when BOTH WACRM_ENABLE_WRITES and
// WACRM_ENABLE_BROADCASTS are set. A single call can message up to
// 1000 people, so on top of the env gate the tool requires an
// explicit `confirm: true` argument — the model must consciously opt
// in, and a client that echoes tool args gives the user a last look.
// Marked destructive so hosts prompt before running it.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { errorResult, handle, jsonResult } from './shared.js';

export function registerBroadcastTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_broadcast',
    {
      title: 'Send broadcast',
      description:
        'Launch a template broadcast to a list of recipients (up to 1000). This sends a real WhatsApp template message to every recipient — a mass, irreversible action. You MUST set confirm=true, and you should show the full recipient list and template to the user for approval before calling. The call returns fast; poll get_broadcast for delivery progress.',
      inputSchema: {
        name: z.string().describe('A name for this broadcast campaign (for your own reference).'),
        template_name: z.string().describe('Meta-approved template name.'),
        template_language: z.string().describe('Template language code, e.g. "en_US".'),
        recipients: z
          .array(
            z.object({
              to: z.string().describe('Recipient phone number in E.164 format.'),
              params: z
                .array(z.string())
                .optional()
                .describe('Positional template body variables for this recipient.'),
            }),
          )
          .min(1)
          .max(1000)
          .describe('Recipients (1–1000). Invalid numbers are dropped and counted as rejected.'),
        confirm: z
          .boolean()
          .describe('Must be true to actually send. A safety gate against accidental mass sends.'),
      },
      annotations: {
        title: 'Send broadcast',
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    handle(async ({ confirm, ...body }) => {
      if (confirm !== true) {
        return errorResult(
          'Refusing to send: confirm must be true. This launches a mass broadcast to ' +
            `${body.recipients.length} recipient(s). Confirm the recipient list and template ` +
            'with the user, then call again with confirm=true.',
        );
      }
      return jsonResult(await client.sendBroadcast(body));
    }),
  );
}
