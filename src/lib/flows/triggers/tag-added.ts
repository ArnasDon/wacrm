import { createTriggerNodeDescriptor } from "../registry/factories";
import { tagTriggerConfigSchema } from "../registry/schemas";

export const tagAddedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_tag_added",
  label: "Tag added",
  category: "trigger",
  icon: "tag",
  configSchema: tagTriggerConfigSchema,
  ui: {
    color: "text-pink-400",
    blurb: "Starts when a configured tag is added",
    hue: { l: 0.65, c: 0.15, h: 350 },
  },
});
