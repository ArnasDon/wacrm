import { Camera, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export type MessagingChannel = "whatsapp" | "instagram";

const CHANNEL_META: Record<
  MessagingChannel,
  { icon: typeof Phone; label: string; className: string }
> = {
  whatsapp: {
    icon: Phone,
    label: "WhatsApp",
    className: "bg-emerald-600 text-white",
  },
  instagram: {
    icon: Camera,
    label: "Instagram",
    className: "bg-fuchsia-600 text-white",
  },
};

/**
 * Small corner badge marking which messaging channel a conversation is
 * on. Defaults to WhatsApp when `channel` is unset — every
 * pre-migration-039 conversation implicitly is WhatsApp, and the
 * `conversations.channel` column itself defaults to `'whatsapp'`, so
 * this mirrors the DB rather than introducing a third "unknown" state.
 */
export function ChannelBadge({
  channel,
  className,
}: {
  channel: MessagingChannel | null | undefined;
  className?: string;
}) {
  const meta = CHANNEL_META[channel ?? "whatsapp"];
  const Icon = meta.icon;
  return (
    <span
      title={meta.label}
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-card",
        meta.className,
        className,
      )}
    >
      <Icon className="size-2.5" strokeWidth={2.5} />
    </span>
  );
}
