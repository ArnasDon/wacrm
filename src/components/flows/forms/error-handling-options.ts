import {
  getDeterministicSuccessEdgeTarget,
  type NodeOnError,
} from '@/lib/flows/registry';

export function errorHandlingOptionsForNode(
  nodeType: string,
  config: Record<string, unknown>
): NodeOnError[] {
  const options: NodeOnError[] = ['fail_run', 'fail_branch'];
  if (getDeterministicSuccessEdgeTarget(nodeType, config)) {
    options.push('default_value');
  }
  return options;
}

export function normalizeNodeErrorHandlingConfig(
  nodeType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...config };
  const available = errorHandlingOptionsForNode(nodeType, normalized);
  if (
    typeof normalized.on_error === "string" &&
    !available.includes(normalized.on_error as NodeOnError)
  ) {
    normalized.on_error = "fail_run";
  }
  if (normalized.on_error !== "default_value") {
    delete normalized.default_value;
  }
  if (normalized.on_error !== "fail_branch") {
    delete normalized.error_next_node_key;
  }
  return normalized;
}
