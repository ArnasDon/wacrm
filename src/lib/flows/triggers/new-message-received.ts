import { createTriggerNodeDescriptor } from "../registry/factories";
import { triggerConfigSchema } from "../registry/schemas";

export const newMessageReceivedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_new_message_received",
  label: "New message received",
  category: "trigger",
  icon: "radio",
  configSchema: triggerConfigSchema,
  ui: {
    color: "text-emerald-400",
    blurb: "Starts when a new inbound message arrives",
    hue: { l: 0.62, c: 0.13, h: 162 },
  },
});
