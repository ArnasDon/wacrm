import { describe, expect, it } from "vitest";
import { withSelectedContact } from "./contact-picker";

describe("withSelectedContact", () => {
  it("prepends the selected contact when the search results miss it", () => {
    expect(
      withSelectedContact([{ id: "b" }, { id: "c" }], { id: "a" }).map((c) => c.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate a selected contact already in the results", () => {
    expect(
      withSelectedContact([{ id: "a" }, { id: "b" }], { id: "a" }).map((c) => c.id),
    ).toEqual(["a", "b"]);
  });

  it("returns the results unchanged with no selection", () => {
    expect(withSelectedContact([{ id: "a" }], null)).toEqual([{ id: "a" }]);
  });
});
