import { Workflow, Node, Edge, NodeType } from '../models/workflow';

export interface ValidationError {
    node?: string;
    edge?: string;
    message: string;
    severity: 'error' | 'warning';
}

/**
 * Validate a workflow for structural correctness
 */
export function validateWorkflow(workflow: Workflow): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodeIds = new Set(workflow.nodes.map(n => n.id));
    const nodeIdList = workflow.nodes.map(n => n.id);

    // Check for duplicate IDs
    if (nodeIds.size !== nodeIdList.length) {
        errors.push({ message: 'Duplicate node IDs found', severity: 'error' });
    }

    // Check for exactly one Start node
    const startNodes = workflow.nodes.filter(n => n.type === NodeType.Start);
    if (startNodes.length === 0) {
        errors.push({ message: 'Workflow must have exactly one Start node', severity: 'error' });
    } else if (startNodes.length > 1) {
        errors.push({ message: `Workflow has ${startNodes.length} Start nodes; expected exactly one`, severity: 'error' });
    }

    // Check for at least one End node
    const endNodes = workflow.nodes.filter(n => n.type === NodeType.End);
    if (endNodes.length === 0) {
        errors.push({ message: 'Workflow must have at least one End node', severity: 'warning' });
    }

    // Check edge references
    for (const edge of workflow.edges) {
        if (!nodeIds.has(edge.source)) {
            errors.push({ edge: edge.id, message: `Edge source '${edge.source}' does not exist`, severity: 'error' });
        }
        if (!nodeIds.has(edge.target)) {
            errors.push({ edge: edge.id, message: `Edge target '${edge.target}' does not exist`, severity: 'error' });
        }
        if (edge.source === edge.target) {
            errors.push({ edge: edge.id, message: 'Edge cannot connect a node to itself', severity: 'error' });
        }
    }

    // Check for duplicate edges
    const edgeKeys = workflow.edges.map(e => `${e.source}->${e.target}`);
    if (new Set(edgeKeys).size !== edgeKeys.length) {
        errors.push({ message: 'Duplicate edges found', severity: 'error' });
    }

    // Check for orphan nodes (not connected to anything)
    const connectedNodes = new Set<string>();
    for (const edge of workflow.edges) {
        connectedNodes.add(edge.source);
        connectedNodes.add(edge.target);
    }
    for (const node of workflow.nodes) {
        if (!connectedNodes.has(node.id) && node.type !== NodeType.Start && node.type !== NodeType.End) {
            errors.push({ node: node.id, message: `Node '${node.id}' is not connected to any other node`, severity: 'warning' });
        }
    }

    // Check Agent node data
    for (const node of workflow.nodes) {
        if (node.type === NodeType.Agent) {
            const agentData = node.data as any;
            if (!agentData.agent) {
                errors.push({ node: node.id, message: `Agent node '${node.id}' has no agent configured`, severity: 'error' });
            }
        }
        if (node.type === NodeType.Condition) {
            const condData = node.data as any;
            if (!condData.expression) {
                errors.push({ node: node.id, message: `Condition node '${node.id}' has no expression`, severity: 'error' });
            }
        }
    }

    // Check that Condition nodes have exactly 2 outgoing edges (True/False)
    for (const node of workflow.nodes) {
        if (node.type === NodeType.Condition) {
            const outgoing = workflow.edges.filter(e => e.source === node.id);
            if (outgoing.length !== 2) {
                errors.push({ node: node.id, message: `Condition node '${node.id}' should have exactly 2 outgoing edges (True/False)`, severity: 'error' });
            }
        }
    }

    return errors;
}

/**
 * Check if the workflow graph has cycles (for loop detection)
 */
export function detectCycles(workflow: Workflow): boolean {
    const adj: Map<string, string[]> = new Map();
    for (const node of workflow.nodes) {
        adj.set(node.id, []);
    }
    for (const edge of workflow.edges) {
        adj.get(edge.source)?.push(edge.target);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycleFrom(nodeId: string): boolean {
        visited.add(nodeId);
        recStack.add(nodeId);

        for (const neighbor of adj.get(nodeId) || []) {
            if (!visited.has(neighbor)) {
                if (hasCycleFrom(neighbor)) return true;
            } else if (recStack.has(neighbor)) {
                return true;
            }
        }

        recStack.delete(nodeId);
        return false;
    }

    for (const node of workflow.nodes) {
        if (!visited.has(node.id)) {
            if (hasCycleFrom(node.id)) return true;
        }
    }

    return false;
}
