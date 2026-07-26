import { createTriggerNodeDescriptor } from "../registry/factories";
import { keywordTriggerConfigSchema } from "../registry/schemas";

export const keywordMatchTriggerDescriptor = createTriggerNodeDescriptor({
  id: "trigger_keyword_match",
  label: "Keyword match",
  category: "trigger",
  icon: "message-circle",
  configSchema: keywordTriggerConfigSchema,
  compatibilityFlowTriggerType: "keyword",
  ui: {
    color: "text-sky-400",
    blurb: "Starts when inbound text matches configured keywords",
    hue: { l: 0.62, c: 0.15, h: 235 },
  },
});
