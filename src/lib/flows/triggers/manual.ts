import { createTriggerNodeDescriptor } from "../registry/factories";
import { triggerConfigSchema } from "../registry/schemas";

export const manualTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_manual",
  label: "Manual",
  category: "trigger",
  icon: "play-circle",
  configSchema: triggerConfigSchema,
  ui: {
    color: "text-muted-foreground",
    blurb: "Starts only when explicitly dispatched",
    hue: { l: 0.55, c: 0.01, h: 260 },
  },
});
