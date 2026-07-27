import { createTriggerNodeDescriptor } from "../registry/factories";
import { timeTriggerConfigSchema } from "../registry/schemas";

export const timeBasedTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_time_based",
  label: "Time based",
  category: "trigger",
  icon: "alarm-clock",
  configSchema: timeTriggerConfigSchema,
  compatibilityFlowTriggerType: "time",
  ui: {
    color: "text-orange-400",
    blurb: "Starts on a configured schedule",
    hue: { l: 0.67, c: 0.15, h: 55 },
  },
});
