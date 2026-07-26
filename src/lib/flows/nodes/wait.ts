import { createLinearNodeDescriptor } from "../registry/factories";
import { waitConfigSchema } from "../registry/schemas";

export const waitNodeDescriptor = createLinearNodeDescriptor({
  id: "wait",
  label: "Wait",
  category: "flow",
  icon: "clock",
  configSchema: waitConfigSchema,
  runtimeKind: "suspend",
  runtimeHook: "wait",
  supportsFlowRuntime: true,
  visible: true,
  form: {
    kind: "fields",
    fields: [
      { kind: "number", key: "amount", label: "Duration", min: 1 },
      {
        kind: "select",
        key: "unit",
        label: "Unit",
        options: [
          { value: "minutes", label: "Minutes" },
          { value: "hours", label: "Hours" },
          { value: "days", label: "Days" },
        ],
      },
      { kind: "next-node", key: "next_node_key", label: "Continue to" },
    ],
    help: "Durable wait. Maximum duration is 365 days.",
  },
  defaultConfig: { amount: 1, unit: "hours", next_node_key: "" },
  ui: {
    color: "text-orange-400",
    blurb: "Pauses execution for a duration",
    hue: { l: 0.67, c: 0.15, h: 55 },
  },
});
