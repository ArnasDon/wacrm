import type { LeadTemperature } from "@/types";
import { Flame, Snowflake, Sun, HelpCircle } from "lucide-react";

// Shared config for the temperature board (desktop + mobile). Kept in
// its own module so both board components can import it without a
// circular dependency.

export type ColumnKey = LeadTemperature | "unclassified";

export const TEMPERATURE_COLUMNS: {
  key: ColumnKey;
  color: string;
  icon: typeof Flame;
}[] = [
  { key: "unclassified", color: "#71717a", icon: HelpCircle },
  { key: "cold", color: "#3b82f6", icon: Snowflake },
  { key: "warm", color: "#f97316", icon: Sun },
  { key: "hot", color: "#ef4444", icon: Flame },
];

/** The three real, settable values (drag/menu can't target "unclassified"). */
export const SETTABLE_TEMPERATURES: LeadTemperature[] = ["cold", "warm", "hot"];
