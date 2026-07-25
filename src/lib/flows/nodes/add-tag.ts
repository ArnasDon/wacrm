import { createLinearNodeDescriptor } from "../registry/factories";
import { tagActionConfigSchema } from "../registry/schemas";

export const addTagNodeDescriptor = createLinearNodeDescriptor({
  id: "add_tag",
  label: "Add tag",
  category: "data",
  icon: "badge-plus",
  configSchema: tagActionConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-pink-400",
    blurb: "Adds a tag to the contact",
    hue: { l: 0.65, c: 0.15, h: 350 },
  },
});
