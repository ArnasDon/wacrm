import { createLinearNodeDescriptor } from "../registry/factories";
import { tagActionConfigSchema } from "../registry/schemas";

export const removeTagNodeDescriptor = createLinearNodeDescriptor({
  id: "remove_tag",
  label: "Remove tag",
  category: "data",
  icon: "tags",
  configSchema: tagActionConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-rose-400",
    blurb: "Removes a tag from the contact",
    hue: { l: 0.63, c: 0.14, h: 15 },
  },
});
