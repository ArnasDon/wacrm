export interface AssignmentResult {
  assignedAgentId: string | null;
  rejected: boolean;
}

export function resolveAssignmentResult(
  requestedAgentId: string | null,
  storedAgentId: string | null | undefined,
): AssignmentResult {
  const assignedAgentId = storedAgentId ?? null;
  return {
    assignedAgentId,
    rejected: assignedAgentId !== requestedAgentId,
  };
}
