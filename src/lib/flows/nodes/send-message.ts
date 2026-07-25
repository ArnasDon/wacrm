import { createLinearNodeDescriptor } from "../registry/factories";
import { sendMessageConfigSchema } from "../registry/schemas";

export const sendMessageNodeDescriptor = createLinearNodeDescriptor({
  id: "send_message",
  label: "Send message",
  category: "messaging",
  icon: "message-circle",
  configSchema: sendMessageConfigSchema,
  runtimeHook: "send_message",
  visible: true,
  form: {
    kind: "fields",
    fields: [
      { kind: "textarea", key: "text", label: "Text to customer", rows: 3 },
      { kind: "next-node", key: "next_node_key", label: "Advances to" },
    ],
  },
  defaultConfig: { text: "", next_node_key: "" },
  ui: {
    color: "text-sky-400",
    blurb: "Sends a WhatsApp text message",
    hue: { l: 0.6, c: 0.18, h: 293 },
  },
});
