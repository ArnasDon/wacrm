import { describe, it, expect } from "vitest";
import { resolveAssignmentResult } from "./assignment";

describe("resolveAssignmentResult", () => {
  it("accepts an assignment the database stored as requested", () => {
    expect(resolveAssignmentResult("agent-1", "agent-1")).toEqual({
      assignedAgentId: "agent-1",
      rejected: false,
    });
  });

  it("accepts an unassignment", () => {
    expect(resolveAssignmentResult(null, null)).toEqual({
      assignedAgentId: null,
      rejected: false,
    });
  });

  it("treats a missing stored value as unassigned", () => {
    expect(resolveAssignmentResult(null, undefined)).toEqual({
      assignedAgentId: null,
      rejected: false,
    });
  });

  it("flags a non-member assignee that the database kept as the previous agent", () => {
    expect(resolveAssignmentResult("removed-agent", "agent-1")).toEqual({
      assignedAgentId: "agent-1",
      rejected: true,
    });
  });

  it("flags a non-member assignee that the database cleared", () => {
    expect(resolveAssignmentResult("removed-agent", null)).toEqual({
      assignedAgentId: null,
      rejected: true,
    });
  });
});
