import { createLinearNodeDescriptor } from "../registry/factories";
import { httpRequestConfigSchema } from "../registry/schemas";
import { CONTROL_INPUT, CONTROL_OUTPUT } from "../registry/types";

export const httpRequestNodeDescriptor = createLinearNodeDescriptor({
  id: "http_request",
  label: "HTTP request",
  category: "data",
  icon: "webhook",
  configSchema: httpRequestConfigSchema,
  inputs: [
    ...CONTROL_INPUT,
    {
      id: "request",
      label: "Request data",
      type: "json",
      cardinality: "one",
    },
  ],
  outputs: [
    ...CONTROL_OUTPUT,
    {
      id: "response",
      label: "Response",
      type: "json",
      cardinality: "many",
    },
  ],
  runtimeKind: "auto",
  runtimeHook: "http_request",
  resolveOutput: (config, portId, vars) =>
    portId === "response" && typeof config.response_var === "string"
      ? vars[config.response_var]
      : undefined,
  visible: true,
  form: { kind: "specialized", component: "http_request" },
  defaultConfig: {
    method: "GET",
    url: "",
    headers: {},
    response_var: "response",
    next_node_key: "",
  },
  ui: {
    color: "text-cyan-400",
    blurb: "Calls a public HTTP API",
    hue: { l: 0.69, c: 0.14, h: 220 },
  },
});
