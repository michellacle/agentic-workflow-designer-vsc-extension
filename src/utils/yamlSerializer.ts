import * as yaml from 'js-yaml';
import {
    Workflow, Node, Edge, NodeType,
    NodeData, StartNodeData, EndNodeData,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData
} from '../models/workflow';

/**
 * Serialize a Workflow object to YAML string
 */
export function workflowToYaml(workflow: Workflow): string {
    const yamlObj: any = {
        name: workflow.name,
        nodes: [],
        edges: []
    };

    if (workflow.description) {
        yamlObj.description = workflow.description;
    }

    for (const node of workflow.nodes) {
        const nodeObj: any = {
            id: node.id,
            type: node.type,
            position: { x: node.position.x, y: node.position.y }
        };

        // Add type-specific data
        switch (node.type) {
            case NodeType.Start:
                if ((node.data as StartNodeData).label) {
                    nodeObj.data = { label: (node.data as StartNodeData).label };
                }
                break;
            case NodeType.End:
                if ((node.data as EndNodeData).label) {
                    nodeObj.data = { label: (node.data as EndNodeData).label };
                }
                break;
            case NodeType.Agent:
                const agentData = node.data as AgentNodeData;
                nodeObj.data = {
                    agent: agentData.agent,
                    prompt: agentData.prompt,
                    description: agentData.description,
                    model: agentData.model,
                    timeout: agentData.timeout,
                    retries: agentData.retries,
                    stateWrites: agentData.stateWrites
                };
                break;
            case NodeType.Condition:
                const condData = node.data as ConditionNodeData;
                nodeObj.data = {
                    expression: condData.expression,
                    description: condData.description
                };
                break;
            case NodeType.HumanApproval:
                const approvalData = node.data as HumanApprovalNodeData;
                nodeObj.data = {
                    message: approvalData.message,
                    description: approvalData.description
                };
                break;
            case NodeType.Delay:
                const delayData = node.data as DelayNodeData;
                nodeObj.data = {
                    duration: delayData.duration,
                    description: delayData.description
                };
                break;
        }

        yamlObj.nodes.push(nodeObj);
    }

    for (const edge of workflow.edges) {
        const edgeObj: any = {
            source: edge.source,
            target: edge.target
        };
        if (edge.label) edgeObj.label = edge.label;
        if (edge.priority !== undefined) edgeObj.priority = edge.priority;
        yamlObj.edges.push(edgeObj);
    }

    return yaml.dump(yamlObj, { lineWidth: -1, noRefs: true });
}

/**
 * Parse a YAML string into a Workflow object
 */
export function yamlToWorkflow(yamlStr: string): Workflow {
    const obj: any = yaml.load(yamlStr);
    const workflow: Workflow = {
        name: obj.name || 'untitled-workflow',
        description: obj.description,
        nodes: [],
        edges: []
    };

    if (obj.nodes) {
        for (const n of obj.nodes) {
            const node: Node = {
                id: n.id,
                type: n.type as NodeType,
                position: { x: n.position?.x || 0, y: n.position?.y || 0 },
                data: parseNodeData(n.type as NodeType, n.data || {})
            };
            workflow.nodes.push(node);
        }
    }

    if (obj.edges) {
        for (const e of obj.edges) {
            const edge: Edge = {
                id: `${e.source}->${e.target}`,
                source: e.source,
                target: e.target,
                label: e.label,
                priority: e.priority
            };
            workflow.edges.push(edge);
        }
    }

    return workflow;
}

function parseNodeData(type: NodeType, raw: any): NodeData {
    switch (type) {
        case NodeType.Start:
            return { label: raw.label } as StartNodeData;
        case NodeType.End:
            return { label: raw.label } as EndNodeData;
        case NodeType.Agent:
            return {
                agent: raw.agent || '',
                prompt: raw.prompt,
                description: raw.description,
                model: raw.model,
                timeout: raw.timeout,
                retries: raw.retries,
                stateWrites: raw.stateWrites
            } as AgentNodeData;
        case NodeType.Condition:
            return {
                expression: raw.expression || '',
                description: raw.description
            } as ConditionNodeData;
        case NodeType.HumanApproval:
            return {
                message: raw.message || 'Approve this step?',
                description: raw.description
            } as HumanApprovalNodeData;
        case NodeType.Delay:
            return {
                duration: raw.duration || 5,
                description: raw.description
            } as DelayNodeData;
        default:
            return {} as NodeData;
    }
}
