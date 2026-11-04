import { describe, expect, it } from "vitest";
import { parseReplyTarget } from "./reply-target";

describe("parseReplyTarget", () => {
  it("accepts whole minutes from 1 to 1440", () => {
    expect(parseReplyTarget("1")).toBe(1);
    expect(parseReplyTarget(" 15 ")).toBe(15);
    expect(parseReplyTarget("1440")).toBe(1440);
  });

  it("rejects values the database constraint would refuse", () => {
    expect(parseReplyTarget("0")).toBeNull();
    expect(parseReplyTarget("1441")).toBeNull();
    expect(parseReplyTarget("2.5")).toBeNull();
    expect(parseReplyTarget("-3")).toBeNull();
    expect(parseReplyTarget("")).toBeNull();
    expect(parseReplyTarget("abc")).toBeNull();
  });
});
