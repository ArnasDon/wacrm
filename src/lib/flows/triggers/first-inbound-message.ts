import { createTriggerNodeDescriptor } from "../registry/factories";
import { triggerConfigSchema } from "../registry/schemas";

export const firstInboundMessageTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_first_inbound_message",
  label: "First inbound message",
  category: "trigger",
  icon: "inbox",
  configSchema: triggerConfigSchema,
  ui: {
    color: "text-teal-400",
    blurb: "Starts on a contact's first inbound message",
    hue: { l: 0.64, c: 0.11, h: 185 },
  },
});
