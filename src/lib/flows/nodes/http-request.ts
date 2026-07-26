import { createLinearNodeDescriptor } from "../registry/factories";
import { httpRequestConfigSchema } from "../registry/schemas";

export const httpRequestNodeDescriptor = createLinearNodeDescriptor({
  id: "http_request",
  label: "HTTP request",
  category: "data",
  icon: "webhook",
  configSchema: httpRequestConfigSchema,
  runtimeKind: "auto",
  runtimeHook: "http_request",
  visible: true,
  form: {
    kind: "fields",
    fields: [
      {
        kind: "select",
        key: "method",
        label: "Method",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({
          value,
          label: value,
        })),
      },
      { kind: "text", key: "url", label: "URL" },
      { kind: "textarea", key: "body", label: "Request body", rows: 4 },
      { kind: "text", key: "response_var", label: "Response variable" },
      { kind: "next-node", key: "next_node_key", label: "Continue to" },
    ],
    help: "Only public HTTP(S) targets and JSON/text responses are allowed.",
  },
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
