import { createTriggerNodeDescriptor } from "../registry/factories";
import { interactiveReplyTriggerConfigSchema } from "../registry/schemas";

export const interactiveReplyTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_interactive_reply",
  label: "Interactive reply",
  category: "trigger",
  icon: "list-checks",
  configSchema: interactiveReplyTriggerConfigSchema,
  ui: {
    color: "text-indigo-400",
    blurb: "Starts when a button or list reply id matches",
    hue: { l: 0.62, c: 0.15, h: 277 },
  },
});
