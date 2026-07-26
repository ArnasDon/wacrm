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
