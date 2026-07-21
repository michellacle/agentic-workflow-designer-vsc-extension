import {
    WorkflowState, ExecutionContext, ExecutionStatus,
    NodeExecutionRecord, NodeStatus
} from '../models/workflow';

/**
 * Deep execution state module.
 *
 * Interface: processNode(), get/set state, initialize(), complete(), getStatus().
 * All node lifecycle (record creation, status transitions, timing) sits behind
 * processNode — callers pass behaviour, not orchestration steps.
 */
export class StateManager {
    private _context: ExecutionContext;

    constructor() {
        this._context = {
            status: ExecutionStatus.Idle,
            state: {},
            nodeRecords: new Map(),
            iterationCounts: new Map()
        };
    }

    get state(): WorkflowState {
        return this._context.state;
    }

    get context(): ExecutionContext {
        return this._context;
    }

    /**
     * Get a value from state
     */
    get(key: string): unknown {
        return this._context.state[key];
    }

    /**
     * Set a value in state
     */
    set(key: string, value: unknown): void {
        this._context.state[key] = value;
    }

    /**
     * Get the current execution status
     */
    getStatus(): ExecutionStatus {
        return this._context.status;
    }

    /**
     * Set the execution status
     */
    setStatus(status: ExecutionStatus): void {
        this._context.status = status;
    }

    /**
     * Process a node's full lifecycle in a single call.
     * Creates the record, sets current node, starts timing, runs the callback,
     * then finalizes timing and status.
     *
     * This is the deep interface — one crossing per node, all lifecycle
     * transitions happen internally.
     */
    async processNode<T>(nodeId: string, label: string, callback: () => Promise<T>): Promise<T> {
        this._context.currentNodeId = nodeId;
        const record: NodeExecutionRecord = {
            nodeId,
            nodeName: label,
            status: NodeStatus.Running,
            startTime: Date.now(),
            logs: [],
            errors: []
        };
        this._context.nodeRecords.set(nodeId, record);

        try {
            const result = await callback();
            record.endTime = Date.now();
            record.duration = record.endTime - record.startTime!;
            record.status = NodeStatus.Completed;
            return result;
        } catch (error) {
            record.endTime = Date.now();
            record.duration = record.endTime - record.startTime!;
            record.status = NodeStatus.Failed;
            record.errors?.push(String(error));
            throw error;
        }
    }

    /**
     * Mark a node as skipped (untaken branch).
     */
    skipNode(nodeId: string, label: string): void {
        const record: NodeExecutionRecord = {
            nodeId,
            nodeName: label,
            status: NodeStatus.Skipped,
            logs: [],
            errors: []
        };
        this._context.nodeRecords.set(nodeId, record);
    }

    /**
     * Mark the start node as already-completed (no execution needed).
     */
    markStartCompleted(nodeId: string, label: string): void {
        this._context.currentNodeId = nodeId;
        const record: NodeExecutionRecord = {
            nodeId,
            nodeName: label,
            status: NodeStatus.Completed,
            logs: [],
            errors: []
        };
        this._context.nodeRecords.set(nodeId, record);
    }

    /**
     * Get a node execution record
     */
    getNodeRecord(nodeId: string): NodeExecutionRecord | undefined {
        return this._context.nodeRecords.get(nodeId);
    }

    /**
     * Add a log entry to a node record
     */
    addLog(nodeId: string, message: string): void {
        const record = this._context.nodeRecords.get(nodeId);
        if (record) {
            record.logs?.push(message);
        }
    }

    /**
     * Add an error to a node record
     */
    addError(nodeId: string, message: string): void {
        const record = this._context.nodeRecords.get(nodeId);
        if (record) {
            record.errors?.push(message);
        }
    }

    /**
     * Get or increment iteration count for a loop
     */
    getIterationCount(loopId: string): number {
        const count = this._context.iterationCounts.get(loopId) || 0;
        this._context.iterationCounts.set(loopId, count + 1);
        return count + 1;
    }

    /**
     * Get current iteration count without incrementing
     */
    getCurrentIteration(loopId: string): number {
        return this._context.iterationCounts.get(loopId) || 0;
    }

    /**
     * Create a snapshot of current state
     */
    snapshot(): WorkflowState {
        return JSON.parse(JSON.stringify(this._context.state));
    }

    /**
     * Restore state from a snapshot
     */
    restore(snapshot: WorkflowState): void {
        this._context.state = JSON.parse(JSON.stringify(snapshot));
    }

    /**
     * Initialize a new execution context.
     * @param initialState Optional initial state values to populate the state bag with.
     */
    initialize(initialState?: Record<string, unknown>): void {
        const state: WorkflowState = {};
        if (initialState) {
            // Deep-copy to avoid external mutations
            Object.assign(state, JSON.parse(JSON.stringify(initialState)));
        }
        this._context = {
            status: ExecutionStatus.Running,
            state,
            nodeRecords: new Map(),
            iterationCounts: new Map(),
            startTime: Date.now()
        };
    }

    /**
     * Complete execution
     */
    complete(status: ExecutionStatus): void {
        this._context.status = status;
        this._context.endTime = Date.now();
    }
}
