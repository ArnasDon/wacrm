import { createTerminalNodeDescriptor } from "../registry/factories";
import { handoffConfigSchema } from "../registry/schemas";

export const handoffNodeDescriptor = createTerminalNodeDescriptor({
  id: "handoff",
  label: "Handoff to agent",
  category: "flow",
  icon: "user-plus",
  configSchema: handoffConfigSchema,
  visible: true,
  form: {
    kind: "fields",
    fields: [{ kind: "textarea", key: "note", label: "Internal note", rows: 2 }],
  },
  defaultConfig: { note: "" },
  ui: {
    color: "text-amber-400",
    blurb: "Hands the conversation to a human",
    hue: { l: 0.65, c: 0.17, h: 16 },
  },
});
