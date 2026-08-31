import { describe, it, expect } from "vitest";
import { channelBadge, countActiveChannels } from "./conversation-list";
import type { Conversation } from "@/types";

const withConnection = (
  connection: Conversation["connection"],
): Pick<Conversation, "connection"> => ({ connection });

describe("channelBadge", () => {
  it("returns null when the account has at most one active channel", () => {
    expect(
      channelBadge(withConnection({ provider: "meta", display_phone: null, label: null }), 1),
    ).toBeNull();
    expect(
      channelBadge(withConnection({ provider: "uazapi", display_phone: null, label: null }), 0),
    ).toBeNull();
  });

  it("returns null when the row carries no connection", () => {
    expect(channelBadge(withConnection(null), 2)).toBeNull();
    expect(channelBadge(withConnection(undefined), 2)).toBeNull();
  });

  it("labels a Meta connection", () => {
    expect(
      channelBadge(
        withConnection({ provider: "meta", display_phone: "+1 555", label: null }),
        2,
      ),
    ).toBe("Meta");
  });

  it("labels a UAZAPI connection as QR", () => {
    expect(
      channelBadge(
        withConnection({ provider: "uazapi", display_phone: null, label: "Sales" }),
        2,
      ),
    ).toBe("QR");
  });
});

describe("countActiveChannels", () => {
  it("counts distinct providers across the loaded conversations", () => {
    const rows = [
      { connection: { provider: "meta", display_phone: null, label: null } },
      { connection: { provider: "meta", display_phone: null, label: null } },
      { connection: { provider: "uazapi", display_phone: null, label: null } },
      { connection: null },
    ] as Conversation[];
    expect(countActiveChannels(rows)).toBe(2);
    expect(countActiveChannels([])).toBe(0);
  });
});
