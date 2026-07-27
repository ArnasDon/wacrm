import { createTriggerNodeDescriptor } from "../registry/factories";
import { webhookTriggerConfigSchema } from "../registry/schemas";

export const webhookTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_webhook",
  label: "Webhook",
  category: "trigger",
  icon: "webhook",
  configSchema: webhookTriggerConfigSchema,
  compatibilityFlowTriggerType: "webhook",
  ui: {
    color: "text-emerald-400",
    blurb: "Starts from a signed public webhook endpoint",
    hue: { l: 0.64, c: 0.14, h: 155 },
  },
});
