import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOW_SHORT_MON_FIRST,
  bucketKey,
  bucketRangeKeys,
  daysAgoStart,
  formatBucketLabel,
  formatDateRangeLabel,
  granularityForRangeDays,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from "./date-utils";

describe("startOfLocalDay", () => {
  it("zeroes out the time of a given date", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const out = startOfLocalDay(d);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
    expect(out.getFullYear()).toBe(d.getFullYear());
    expect(out.getMonth()).toBe(d.getMonth());
    expect(out.getDate()).toBe(d.getDate());
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const before = d.getTime();
    startOfLocalDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns midnight N days before today", () => {
    const out = daysAgoStart(3);
    expect(out.getHours()).toBe(0);
    expect(out.getDate()).toBe(15);
    expect(out.getMonth()).toBe(4); // May
    expect(out.getFullYear()).toBe(2026);
  });

  it("daysAgoStart(0) is today at midnight", () => {
    const out = daysAgoStart(0);
    expect(out.getDate()).toBe(18);
    expect(out.getHours()).toBe(0);
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    const out = daysAgoStart(5);
    expect(out.getMonth()).toBe(3); // April (0-indexed)
    expect(out.getDate()).toBe(27);
  });
});

describe("localDayKey", () => {
  it("emits YYYY-MM-DD in local components", () => {
    const d = new Date(2026, 0, 9, 23, 59); // Jan 9, locally
    expect(localDayKey(d)).toBe("2026-01-09");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2026, 8, 5); // Sep 5
    expect(localDayKey(d)).toBe("2026-09-05");
  });

  it("accepts ISO strings as input", () => {
    expect(localDayKey("2026-12-31T23:00:00")).toBe("2026-12-31");
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(3)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    expect(lastNDayKeys(4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("mondayIndex", () => {
  it("maps Monday → 0 and Sunday → 6", () => {
    expect(mondayIndex(new Date("2026-05-18"))).toBe(0); // Mon
    expect(mondayIndex(new Date("2026-05-19"))).toBe(1); // Tue
    expect(mondayIndex(new Date("2026-05-23"))).toBe(5); // Sat
    expect(mondayIndex(new Date("2026-05-24"))).toBe(6); // Sun
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-18"))]).toBe(
      "Mon",
    );
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-24"))]).toBe(
      "Sun",
    );
  });
});

describe("granularityForRangeDays", () => {
  it("buckets short ranges by day", () => {
    expect(granularityForRangeDays(7)).toBe("day");
    expect(granularityForRangeDays(31)).toBe("day");
  });

  it("buckets medium ranges by week", () => {
    expect(granularityForRangeDays(32)).toBe("week");
    expect(granularityForRangeDays(120)).toBe("week");
  });

  it("buckets long ranges by month", () => {
    expect(granularityForRangeDays(121)).toBe("month");
    expect(granularityForRangeDays(365)).toBe("month");
  });
});

describe("bucketKey", () => {
  // Local (non-UTC) Date constructors throughout — new Date("YYYY-MM-DD")
  // parses as UTC, which is exactly what makes mondayIndex's pre-existing
  // tests above fail in a UTC-6 environment; these avoid that trap.
  it("day granularity matches localDayKey", () => {
    const d = new Date(2026, 7, 16); // Aug 16, 2026 — a Sunday
    expect(bucketKey(d, "day")).toBe("2026-08-16");
  });

  it("week granularity keys on that week's Monday", () => {
    const sunday = new Date(2026, 7, 16); // Sun Aug 16
    const wednesday = new Date(2026, 7, 12); // Wed Aug 12, same week
    const monday = new Date(2026, 7, 10); // Mon Aug 10
    expect(bucketKey(sunday, "week")).toBe("2026-08-10");
    expect(bucketKey(wednesday, "week")).toBe("2026-08-10");
    expect(bucketKey(monday, "week")).toBe("2026-08-10");
  });

  it("month granularity keys on YYYY-MM", () => {
    expect(bucketKey(new Date(2026, 7, 1), "month")).toBe("2026-08");
    expect(bucketKey(new Date(2026, 7, 31), "month")).toBe("2026-08");
  });
});

describe("bucketRangeKeys", () => {
  it("day granularity returns one key per calendar day, inclusive", () => {
    const start = new Date(2026, 7, 1);
    const end = new Date(2026, 7, 3);
    expect(bucketRangeKeys(start, end, "day")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("week granularity steps 7 days from the range start's Monday", () => {
    const start = new Date(2026, 7, 10); // Mon Aug 10
    const end = new Date(2026, 7, 24); // Mon Aug 24 (2 weeks later)
    expect(bucketRangeKeys(start, end, "week")).toEqual([
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
  });

  it("month granularity returns one key per calendar month, inclusive, across a year boundary", () => {
    const start = new Date(2026, 10, 15); // Nov 2026
    const end = new Date(2027, 1, 1); // Feb 2027
    expect(bucketRangeKeys(start, end, "month")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });
});

describe("formatBucketLabel", () => {
  it("formats a day/week key as a short month+day", () => {
    expect(formatBucketLabel("2026-08-16", "day")).toMatch(/Aug/);
  });

  it("formats a month key as short month+2-digit year", () => {
    expect(formatBucketLabel("2026-08", "month")).toMatch(/Aug/);
  });
});

describe("formatDateRangeLabel", () => {
  it("joins two formatted dates with an en dash", () => {
    const label = formatDateRangeLabel(new Date(2026, 7, 1), new Date(2026, 7, 16));
    expect(label).toContain("–");
    expect(label).toMatch(/Aug/);
  });
});
