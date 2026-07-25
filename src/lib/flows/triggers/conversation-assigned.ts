import { createTriggerNodeDescriptor } from "../registry/factories";
import { triggerConfigSchema } from "../registry/schemas";

export const conversationAssignedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_conversation_assigned",
  label: "Conversation assigned",
  category: "trigger",
  icon: "circle-user-round",
  configSchema: triggerConfigSchema,
  ui: {
    color: "text-amber-400",
    blurb: "Starts when a conversation is assigned",
    hue: { l: 0.68, c: 0.14, h: 70 },
  },
});
