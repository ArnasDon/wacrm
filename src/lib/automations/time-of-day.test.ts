import { describe, expect, it } from "vitest";
import {
  editConditionConfig,
  isValidTimeZone,
  isWithinTimeWindow,
  listTimeZones,
  minutesInTimeZone,
  withConditionTimezone,
} from "./time-of-day";

const at = (iso: string) => new Date(iso);

describe("time_of_day evaluation", () => {
  it("reads the wall clock of the given zone, not the server's", () => {
    expect(minutesInTimeZone(at("2026-01-15T23:30:00Z"), "UTC")).toBe(23 * 60 + 30);
    expect(minutesInTimeZone(at("2026-01-15T23:30:00Z"), "Asia/Seoul")).toBe(8 * 60 + 30);
    expect(minutesInTimeZone(at("2026-01-15T00:05:00Z"), "America/Sao_Paulo")).toBe(21 * 60 + 5);
  });

  it("reports midnight as 0 minutes", () => {
    expect(minutesInTimeZone(at("2026-01-15T00:00:00Z"), "UTC")).toBe(0);
  });

  it("handles over-midnight windows in the account's zone", () => {
    const night = "18:00-09:00";
    expect(isWithinTimeWindow(night, at("2026-01-15T10:00:00Z"), "Asia/Seoul")).toBe(true);
    expect(isWithinTimeWindow(night, at("2026-01-15T10:00:00Z"), "UTC")).toBe(false);
    expect(isWithinTimeWindow(night, at("2026-01-15T20:00:00Z"), "UTC")).toBe(true);
  });

  it("handles same-day windows with an exclusive end", () => {
    expect(isWithinTimeWindow("09:00-17:00", at("2026-01-15T09:00:00Z"), "UTC")).toBe(true);
    expect(isWithinTimeWindow("09:00-17:00", at("2026-01-15T17:00:00Z"), "UTC")).toBe(false);
  });

  it("falls back to UTC when the condition has no time zone", () => {
    expect(isWithinTimeWindow("18:00-09:00", at("2026-01-15T10:00:00Z"), undefined)).toBe(false);
    expect(isWithinTimeWindow("18:00-09:00", at("2026-01-15T19:00:00Z"), undefined)).toBe(true);
  });

  it("never matches an invalid zone or a malformed window", () => {
    expect(isWithinTimeWindow("18:00-09:00", at("2026-01-15T19:00:00Z"), "Mars/Base")).toBe(false);
    expect(isWithinTimeWindow("18:00", at("2026-01-15T19:00:00Z"), "UTC")).toBe(false);
  });
});

describe("time zone helpers", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/Vilnius")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(3)).toBe(false);
  });

  it("lists UTC first and keeps the current value selectable", () => {
    const zones = listTimeZones("Europe/Vilnius");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Europe/Vilnius");
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("stamps a time zone only on time_of_day conditions that lack one", () => {
    expect(withConditionTimezone({ subject: "time_of_day", operand: "18:00-09:00" }, "Asia/Seoul"))
      .toEqual({ subject: "time_of_day", operand: "18:00-09:00", timezone: "Asia/Seoul" });
    expect(withConditionTimezone({ subject: "time_of_day", timezone: "UTC" }, "Asia/Seoul"))
      .toEqual({ subject: "time_of_day", timezone: "UTC" });
    expect(withConditionTimezone({ subject: "tag_presence" }, "Asia/Seoul"))
      .toEqual({ subject: "tag_presence" });
  });

  it("defaults the zone when an edit turns a condition into time_of_day", () => {
    expect(editConditionConfig({ subject: "tag_presence" }, { subject: "time_of_day" }, "Europe/Vilnius"))
      .toMatchObject({ subject: "time_of_day", timezone: "Europe/Vilnius" });
    expect(editConditionConfig({ subject: "time_of_day", timezone: "UTC" }, { timezone: "Asia/Seoul" }, "Europe/Vilnius"))
      .toMatchObject({ timezone: "Asia/Seoul" });
  });
});
