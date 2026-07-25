import { createLinearNodeDescriptor } from "../registry/factories";
import { linearLegacyConfigSchema } from "../registry/schemas";

export const closeConversationNodeDescriptor = createLinearNodeDescriptor({
  id: "close_conversation",
  label: "Close conversation",
  category: "flow",
  icon: "archive-x",
  configSchema: linearLegacyConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-slate-400",
    blurb: "Closes the active conversation",
    hue: { l: 0.56, c: 0.03, h: 260 },
  },
});
