import { createLinearNodeDescriptor } from "../registry/factories";
import { sendMediaConfigSchema } from "../registry/schemas";

export const sendMediaNodeDescriptor = createLinearNodeDescriptor({
  id: "send_media",
  label: "Send media",
  category: "messaging",
  icon: "paperclip",
  configSchema: sendMediaConfigSchema,
  visible: true,
  form: { kind: "specialized", component: "send_media" },
  defaultConfig: {
    media_type: "image",
    media_url: "",
    caption: "",
    next_node_key: "",
  },
  ui: {
    color: "text-cyan-400",
    blurb: "Sends an image, video, or document",
    hue: { l: 0.65, c: 0.12, h: 210 },
  },
});
