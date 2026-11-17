import { describe, expect, it } from "vitest";
import enMessages from "../../messages/en.json";
import { resolveVariables } from "@/hooks/use-broadcast-sending";
import type { Contact } from "@/types";
import {
  CONTACT_VARIABLE_FIELDS,
  contactVariableValue,
  isContactVariableField,
} from "./broadcast-variables";

const contact: Contact = {
  id: "c1",
  user_id: "u1",
  account_id: "a1",
  name: "Ada Lovelace",
  phone: "+447700900123",
  email: "ada@example.com",
  company: "Analytical Engines Ltd",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("contactVariableValue", () => {
  it("offers every built-in contact field, company included", () => {
    expect(CONTACT_VARIABLE_FIELDS).toEqual(["name", "phone", "email", "company"]);
  });

  it("reads each built-in field from the contact", () => {
    expect(contactVariableValue(contact, "name")).toBe("Ada Lovelace");
    expect(contactVariableValue(contact, "phone")).toBe("+447700900123");
    expect(contactVariableValue(contact, "email")).toBe("ada@example.com");
    expect(contactVariableValue(contact, "company")).toBe("Analytical Engines Ltd");
  });

  it("returns undefined for a missing value or an unknown field", () => {
    expect(contactVariableValue({ ...contact, company: undefined }, "company")).toBeUndefined();
    expect(contactVariableValue(contact, "account_id")).toBeUndefined();
    expect(isContactVariableField("account_id")).toBe(false);
  });

  it("has a mapping label for every field", () => {
    const labels = enMessages.Broadcasts.wizard.personalize.fieldMap as Record<string, string>;
    for (const field of CONTACT_VARIABLE_FIELDS) {
      expect(labels[field]).toBeTruthy();
    }
  });
});

describe("resolveVariables", () => {
  it("resolves a company mapping to the contact's company at send time", () => {
    expect(
      resolveVariables(
        {
          "1": { type: "field", value: "name" },
          "2": { type: "field", value: "company" },
          "3": { type: "static", value: "today" },
        },
        contact,
      ),
    ).toEqual(["Ada Lovelace", "Analytical Engines Ltd", "today"]);
  });

  it("sends an empty string when the contact has no company", () => {
    expect(
      resolveVariables({ "1": { type: "field", value: "company" } }, { ...contact, company: undefined }),
    ).toEqual([""]);
  });
});
