import { createTriggerNodeDescriptor } from "../registry/factories";
import { triggerConfigSchema } from "../registry/schemas";

export const newContactCreatedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_new_contact_created",
  label: "New contact created",
  category: "trigger",
  icon: "contact-round",
  configSchema: triggerConfigSchema,
  ui: {
    color: "text-cyan-400",
    blurb: "Starts when a contact is created",
    hue: { l: 0.66, c: 0.11, h: 205 },
  },
});
