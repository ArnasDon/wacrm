import { createLinearNodeDescriptor } from "../registry/factories";
import { webhookConfigSchema } from "../registry/schemas";

export const sendWebhookNodeDescriptor = createLinearNodeDescriptor({
  id: "send_webhook",
  label: "Send webhook",
  category: "data",
  icon: "webhook",
  configSchema: webhookConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-blue-400",
    blurb: "Calls an external HTTP endpoint",
    hue: { l: 0.62, c: 0.15, h: 250 },
  },
});
