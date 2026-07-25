import { createLinearNodeDescriptor } from "../registry/factories";
import { updateContactFieldConfigSchema } from "../registry/schemas";

export const updateContactFieldNodeDescriptor = createLinearNodeDescriptor({
  id: "update_contact_field",
  label: "Update contact field",
  category: "data",
  icon: "contact-round",
  configSchema: updateContactFieldConfigSchema,
  runtimeKind: "legacy",
  runtimeHook: "legacy_automation_step",
  ui: {
    color: "text-teal-400",
    blurb: "Updates a built-in or custom contact field",
    hue: { l: 0.64, c: 0.1, h: 185 },
  },
});
