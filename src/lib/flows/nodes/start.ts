import { createLinearNodeDescriptor } from "../registry/factories";
import { startConfigSchema } from "../registry/schemas";

export const startNodeDescriptor = createLinearNodeDescriptor({
  id: "start",
  label: "Start",
  category: "flow",
  icon: "play-circle",
  configSchema: startConfigSchema,
  runtimeHook: "start",
  visible: true,
  form: {
    kind: "fields",
    fields: [{ kind: "next-node", key: "next_node_key", label: "Advances to" }],
  },
  defaultConfig: { next_node_key: "" },
  ui: {
    color: "text-emerald-400",
    blurb: "Entry point of the flow",
    hue: { l: 0.62, c: 0.13, h: 162 },
  },
});
