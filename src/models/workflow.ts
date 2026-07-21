/**
 * Supported node types in the workflow designer
 */
export enum NodeType {
    Start = 'start',
    End = 'end',
    Agent = 'agent',
    Condition = 'condition',
    HumanApproval = 'human_approval',
    Delay = 'delay'
}

/**
 * Position on the canvas
 */
export interface Position {
    x: number;
    y: number;
}

/**
 * Base node interface
 */
export interface Node {
    id: string;
    type: NodeType;
    position: Position;
    data: NodeData;
}

/**
 * Union type for all node data shapes
 */
export type NodeData =
    | StartNodeData
    | EndNodeData
    | AgentNodeData
    | ConditionNodeData
    | HumanApprovalNodeData
    | DelayNodeData;

/**
 * Start node data
 */
export interface StartNodeData {
    label?: string;
}

/**
 * End node data
 */
export interface EndNodeData {
    label?: string;
    /** If true (default), generate a summary of the workflow execution when this node is reached. */
    summary?: boolean;
}

/**
 * Agent node data - represents a VS Code custom agent
 */
export interface AgentNodeData {
    agent: string;        // path to .agent.md file
    prompt?: string;
    description?: string;
    model?: string;       // model hint, e.g. "gpt-4o", "claude-sonnet-4-20250514", or vendor "copilot", "anthropic", "openai"
    timeout?: number;     // seconds
    retries?: number;
    stateWrites?: StateWriteMapping[];
}

/**
 * Condition node data - evaluates workflow state
 */
export interface ConditionNodeData {
    expression: string;   // e.g., "state.tests_passed === true"
    description?: string;
}

/**
 * Human Approval node data
 */
export interface HumanApprovalNodeData {
    message: string;
    description?: string;
}

/**
 * Delay node data
 */
export interface DelayNodeData {
    duration: number;     // seconds
    description?: string;
}

/**
 * Edge (connection) between nodes
 */
export interface Edge {
    id: string;
    source: string;       // source node id
    target: string;       // target node id
    label?: string;       // e.g., "True", "False", "Pass", "Fail"
    priority?: number;
}

/**
 * Complete workflow definition
 */
export interface Workflow {
    name: string;
    description?: string;
    /** Initial state values to populate at the start of execution. */
    initialState?: Record<string, unknown>;
    nodes: Node[];
    edges: Edge[];
}

/**
 * Mapping for writing agent output to workflow state
 */
export interface StateWriteMapping {
    source: string;   // field from agent output
    target: string;   // state key to write to
}

/**
 * Node execution status during runtime
 */
export enum NodeStatus {
    Waiting = 'waiting',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
    Paused = 'paused',
    Skipped = 'skipped'
}

/**
 * Execution record for a single node
 */
export interface NodeExecutionRecord {
    nodeId: string;
    nodeName?: string;
    status: NodeStatus;
    startTime?: number;
    endTime?: number;
    duration?: number;
    prompt?: string;
    contextIn?: Record<string, unknown>;
    contextOut?: Record<string, unknown>;
    filesModified?: string[];
    toolUsage?: ToolUsageRecord[];
    logs?: string[];
    errors?: string[];
    structuredOutput?: unknown;
}

/**
 * Tool usage record during agent execution
 */
export interface ToolUsageRecord {
    toolName: string;
    input: unknown;
    output: unknown;
    duration: number;
}

/**
 * Workflow execution state
 */
export interface WorkflowState {
    [key: string]: unknown;
}

/**
 * Overall execution status
 */
export enum ExecutionStatus {
    Idle = 'idle',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Failed = 'failed',
    Stopped = 'stopped'
}

/**
 * Full execution context
 */
export interface ExecutionContext {
    status: ExecutionStatus;
    state: WorkflowState;
    currentNodeId?: string;
    nodeRecords: Map<string, NodeExecutionRecord>;
    iterationCounts: Map<string, number>;
    startTime?: number;
    endTime?: number;
}
