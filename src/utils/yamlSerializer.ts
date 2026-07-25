import * as yaml from 'js-yaml';
import {
    Workflow, Node, Edge, NodeType,
    NodeData, StartNodeData, EndNodeData,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData, LoopNodeData,
    NoteNodeData, ProcessNodeData, DecisionNodeData,
    PortSide
} from '../models/workflow';

/** Plain-object shape for YAML serialization of a workflow. */
interface YamlWorkflowObject {
    name: string;
    description?: string;
    state?: Record<string, unknown>;
    nodes: YamlNodeObject[];
    edges: YamlEdgeObject[];
}

/** Plain-object shape for a single node in YAML. */
interface YamlNodeObject {
    id: string;
    type: string;
    position: { x: number; y: number };
    data?: Record<string, unknown>;
}

/** Plain-object shape for a single edge in YAML. */
interface YamlEdgeObject {
    source: string;
    target: string;
    label?: string;
    priority?: number;
    sourceSide?: PortSide;
    targetSide?: PortSide;
}

/**
 * Serialize a Workflow object to YAML string
 */
export function workflowToYaml(workflow: Workflow): string {
    const yamlObj: YamlWorkflowObject = {
        name: workflow.name,
        nodes: [],
        edges: []
    };

    if (workflow.description) {
        yamlObj.description = workflow.description;
    }

    for (const node of workflow.nodes) {
        const nodeObj: YamlNodeObject = {
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
                const endData = node.data as EndNodeData;
                if (endData.label || endData.summary !== undefined) {
                    nodeObj.data = { label: endData.label, summary: endData.summary };
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
                    prompt: condData.prompt,
                    model: condData.model
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
            case NodeType.Loop:
                const loopData = node.data as LoopNodeData;
                nodeObj.data = {
                    mode: loopData.mode,
                    maxIterations: loopData.maxIterations,
                    expression: loopData.expression,
                    description: loopData.description
                };
                break;
            case NodeType.Note:
                const noteData = node.data as NoteNodeData;
                nodeObj.data = {
                    text: noteData.text,
                    description: noteData.description
                };
                break;
            case NodeType.Process:
                const processData = node.data as ProcessNodeData;
                nodeObj.data = {
                    title: processData.title,
                    description: processData.description
                };
                break;
            case NodeType.Decision:
                const decisionData = node.data as DecisionNodeData;
                nodeObj.data = {
                    question: decisionData.question,
                    options: decisionData.options
                };
                break;
        }

        yamlObj.nodes.push(nodeObj);
    }

    for (const edge of workflow.edges) {
        const edgeObj: YamlEdgeObject = {
            source: edge.source,
            target: edge.target
        };
        if (edge.label) {
            edgeObj.label = edge.label;
        }
        if (edge.priority !== undefined) {
            edgeObj.priority = edge.priority;
        }
        if (edge.sourceSide) {
            edgeObj.sourceSide = edge.sourceSide;
        }
        if (edge.targetSide) {
            edgeObj.targetSide = edge.targetSide;
        }
        yamlObj.edges.push(edgeObj);
    }

    if (workflow.initialState && Object.keys(workflow.initialState).length > 0) {
        yamlObj.state = workflow.initialState;
    }

    return yaml.dump(yamlObj, { lineWidth: -1, noRefs: true });
}

/**
 * Parse a YAML string into a Workflow object
 */
export function yamlToWorkflow(yamlStr: string): Workflow {
    const obj: YamlWorkflowObject = yaml.load(yamlStr) as YamlWorkflowObject;
    const workflow: Workflow = {
        name: obj.name || 'untitled-workflow',
        description: obj.description,
        initialState: obj.state || undefined,
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
                priority: e.priority,
                sourceSide: e.sourceSide,
                targetSide: e.targetSide
            };
            workflow.edges.push(edge);
        }
    }

    return workflow;
}

function parseNodeData(type: NodeType, raw: Record<string, unknown>): NodeData {
    switch (type) {
        case NodeType.Start:
            return { label: raw.label } as StartNodeData;
        case NodeType.End:
            return { label: raw.label, summary: raw.summary !== undefined ? raw.summary : true } as EndNodeData;
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
                prompt: raw.prompt,
                model: raw.model
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
        case NodeType.Loop:
            return {
                mode: raw.mode || 'count',
                maxIterations: raw.maxIterations || 1,
                expression: raw.expression,
                description: raw.description
            } as LoopNodeData;
        case NodeType.Note:
            return {
                text: raw.text || '',
                description: raw.description
            } as NoteNodeData;
        case NodeType.Process:
            return {
                title: raw.title || '',
                description: raw.description
            } as ProcessNodeData;
        case NodeType.Decision:
            return {
                question: raw.question || '',
                options: raw.options
            } as DecisionNodeData;
        default:
            return {} as NodeData;
    }
}
