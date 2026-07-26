import { getNodeDescriptor } from './registry';
import type { NodePortDescriptor, NodePortType } from './registry/types';

export interface CanvasConnectionCandidate {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface CanvasConnectionNode {
  node_key: string;
  node_type: string;
}

export interface ExistingCanvasConnection {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export type ConnectionRejectionReason =
  | 'incomplete'
  | 'unknown_node'
  | 'unknown_source_port'
  | 'unknown_target_port'
  | 'self_edge'
  | 'duplicate'
  | 'source_cardinality'
  | 'target_cardinality'
  | 'incompatible_types';

export type ConnectionValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason: ConnectionRejectionReason;
      message: string;
    };

const REJECTION_MESSAGES: Record<ConnectionRejectionReason, string> = {
  incomplete: 'Choose both a source and a target port.',
  unknown_node: 'This connection references an unknown node.',
  unknown_source_port: 'The source port is no longer available.',
  unknown_target_port: 'The target port is no longer available.',
  self_edge: 'A node cannot connect to itself.',
  duplicate: 'This connection already exists.',
  source_cardinality: 'This output already has its maximum connection.',
  target_cardinality: 'This input already has its maximum connection.',
  incompatible_types: 'These port types are not compatible.',
};

function reject(reason: ConnectionRejectionReason): ConnectionValidationResult {
  return { valid: false, reason, message: REJECTION_MESSAGES[reason] };
}

/**
 * Control edges describe execution order and never carry values. `any` is a
 * wildcard for data ports, not a bridge between the data and control graphs.
 */
export function arePortTypesCompatible(
  source: NodePortType,
  target: NodePortType
): boolean {
  if (source === 'control' || target === 'control') {
    return source === 'control' && target === 'control';
  }
  return source === 'any' || target === 'any' || source === target;
}

function normalizedHandle(
  handle: string | null | undefined,
  ports: readonly NodePortDescriptor[]
): string | null {
  if (handle) return handle;
  return ports.length === 1 ? ports[0].id : null;
}

function resolvePort(
  handle: string | null | undefined,
  ports: readonly NodePortDescriptor[]
): NodePortDescriptor | undefined {
  const normalized = normalizedHandle(handle, ports);
  if (!normalized) return undefined;
  return ports.find(
    (port) =>
      port.id === normalized ||
      (port.handlePrefix !== undefined &&
        normalized.startsWith(port.handlePrefix) &&
        normalized.length > port.handlePrefix.length)
  );
}

function sameHandle(
  existing: string | null | undefined,
  candidate: string | null | undefined,
  ports: readonly NodePortDescriptor[]
): boolean {
  return (
    normalizedHandle(existing, ports) === normalizedHandle(candidate, ports)
  );
}

export function validatePortConnection(
  connection: CanvasConnectionCandidate,
  existingConnections: readonly ExistingCanvasConnection[],
  sourcePort: NodePortDescriptor,
  targetPort: NodePortDescriptor,
  sourcePorts: readonly NodePortDescriptor[] = [sourcePort],
  targetPorts: readonly NodePortDescriptor[] = [targetPort]
): ConnectionValidationResult {
  if (!connection.source || !connection.target) return reject('incomplete');
  if (connection.source === connection.target) return reject('self_edge');

  const matchesSourceHandle = (edge: ExistingCanvasConnection) =>
    edge.source === connection.source &&
    sameHandle(edge.sourceHandle, connection.sourceHandle, sourcePorts);
  const matchesTargetHandle = (edge: ExistingCanvasConnection) =>
    edge.target === connection.target &&
    sameHandle(edge.targetHandle, connection.targetHandle, targetPorts);

  if (
    existingConnections.some(
      (edge) =>
        matchesSourceHandle(edge) &&
        matchesTargetHandle(edge) &&
        edge.target === connection.target
    )
  ) {
    return reject('duplicate');
  }
  if (
    sourcePort.cardinality === 'one' &&
    existingConnections.some(matchesSourceHandle)
  ) {
    return reject('source_cardinality');
  }
  if (
    targetPort.cardinality === 'one' &&
    existingConnections.some(matchesTargetHandle)
  ) {
    return reject('target_cardinality');
  }
  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
    return reject('incompatible_types');
  }
  return { valid: true };
}

/**
 * Canvas boundary validator. Descriptor lookup stays here so both existing
 * control-only flows and future typed data ports use the canonical registry.
 */
export function validateCanvasConnection(
  connection: CanvasConnectionCandidate,
  nodes: readonly CanvasConnectionNode[],
  existingConnections: readonly ExistingCanvasConnection[]
): ConnectionValidationResult {
  if (!connection.source || !connection.target) return reject('incomplete');
  if (connection.source === connection.target) return reject('self_edge');

  const sourceNode = nodes.find((node) => node.node_key === connection.source);
  const targetNode = nodes.find((node) => node.node_key === connection.target);
  if (!sourceNode || !targetNode) return reject('unknown_node');

  const sourceDescriptor = getNodeDescriptor(sourceNode.node_type);
  const targetDescriptor = getNodeDescriptor(targetNode.node_type);
  if (!sourceDescriptor || !targetDescriptor) return reject('unknown_node');

  const sourcePort = resolvePort(
    connection.sourceHandle,
    sourceDescriptor.outputs
  );
  if (!sourcePort) return reject('unknown_source_port');
  const targetPort = resolvePort(
    connection.targetHandle,
    targetDescriptor.inputs
  );
  if (!targetPort) return reject('unknown_target_port');

  return validatePortConnection(
    connection,
    existingConnections,
    sourcePort,
    targetPort,
    sourceDescriptor.outputs,
    targetDescriptor.inputs
  );
}
