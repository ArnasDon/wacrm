import { createLinearNodeDescriptor } from "../registry/factories";
import { assignConversationConfigSchema } from "../registry/schemas";

export const assignConversationNodeDescriptor = createLinearNodeDescriptor({
  id: "assign_conversation",
  label: "Assign conversation",
  category: "data",
  icon: "circle-user-round",
  configSchema: assignConversationConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-amber-400",
    blurb: "Assigns the conversation to an agent",
    hue: { l: 0.67, c: 0.14, h: 70 },
  },
});
