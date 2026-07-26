import * as fs from 'fs';
import * as path from 'path';
import {
    Workflow, Node, NodeType,
    ExecutionStatus, NodeStatus,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData, EndNodeData, LoopNodeData,
    ExecutionContext, isAnnotationNode
} from '../models/workflow';
import { StateManager } from './stateManager';
import { ConditionEvaluator } from './conditionEvaluator';
import { CopilotSubagentExecutionContext, IAgentInvoker } from './executionContext';
import { ExecutionObserver } from './executionObserver.interface';
import { validateWorkflow, ValidationError } from '../utils/workflowValidator';
import { exportExecutionLogs } from './executionLogExporter';

/**
 * Node execution result with optional branch information.
 */
export interface NodeExecutionResult {
    success: boolean;
    branchResult?: boolean;
}

/**
 * A plain reference to a document or file from a chat request.
 */
export interface ChatReference {
    documentUri?: string;
}

/**
 * Context from the Copilot Chat request.
 */
export interface ChatRequestContext {
    prompt?: string;
    references?: readonly ChatReference[];
}

/**
 * Execution state change event fired by the executor.
 */
export interface ExecutionStateChangeEvent {
    overall: ExecutionStatus;
    currentNodeId: string | undefined;
    nodeStatuses: Record<string, { status: NodeStatus; startTime?: number; endTime?: number; duration?: number }>;
    /** Per-node execution counts — how many times each node has been entered. */
    nodeExecutionCounts?: Record<string, number>;
}

/**
 * Callback for execution state changes.
 */
export type ExecutionStateChangeListener = (event: ExecutionStateChangeEvent) => void;

/**
 * Options for invoking the executor.
 */
export interface ExecuteOptions {
    workflow: Workflow;
    chatContext?: ChatRequestContext;
    executionContext: CopilotSubagentExecutionContext;
    /** Root path of the workspace, used for resolving agent file paths. */
    workspaceRoot: string;
}

/**
 * Deep workflow execution module.
 *
 * Interface: run(), pause(), stop(), onDidChangeState event.
 * All execution logic sits behind this small interface.
 * UI concerns adapt via the ExecutionObserver seam.
 */
export class WorkflowExecutor {
    private _stateManager: StateManager;
    private _agentInvoker: IAgentInvoker;
    private _abortController: AbortController | null = null;
    private _activeCopilotContext: CopilotSubagentExecutionContext | null = null;
    private _workspaceRoot: string = '';

    private _executionStateListeners: ExecutionStateChangeListener[] = [];

    // Pause/resume state
    private _pauseRequested: boolean = false;
    private _pauseResolver: ((value: void) => void) | null = null;
    private _pausePromise: Promise<void> | null = null;

    /** Maximum times a single node may be executed before loop protection triggers. */
    private static readonly MAX_NODE_EXECUTIONS = 50;

    constructor(private readonly observer: ExecutionObserver, agentInvoker?: IAgentInvoker) {
        this._stateManager = new StateManager();
        this._agentInvoker = agentInvoker ?? null!; // production code must inject AgentInvoker
    }

    /**
     * Subscribe to execution state changes.
     */
    onDidChangeExecutionState(listener: ExecutionStateChangeListener): () => void {
        this._executionStateListeners.push(listener);
        return () => {
            const idx = this._executionStateListeners.indexOf(listener);
            if (idx >= 0) {
                this._executionStateListeners.splice(idx, 1);
            }
        };
    }

    /**
     * Run a workflow. This is the primary interface — everything else is internal.
     */
    async run(options: ExecuteOptions): Promise<ExecutionStatus | undefined> {
        const { workflow, chatContext, executionContext } = options;

        const errors = validateWorkflow(workflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        if (fatalErrors.length > 0) {
            for (const error of fatalErrors) {
                this.observer.onNotification('error', `Validation: ${error.message}`);
            }
            return undefined;
        }

        this.observer.clearLog();
        this.observer.onLog(`▶ Starting workflow with genuine Copilot subagents: ${workflow.name}`);
        this.observer.onLog(`   Nodes: ${workflow.nodes.length}, Edges: ${workflow.edges.length}`);
        this.observer.onLog('');

        this._activeCopilotContext = executionContext;
        const chatCancellation = executionContext.cancellationToken.onCancellationRequested(() => {
            this._abortController?.abort();
            this._stateManager.complete(ExecutionStatus.Stopped);
            this.observer.onStatusChange(ExecutionStatus.Stopped);
        });

        try {
            await this.execute(workflow, chatContext, options.workspaceRoot);
            return this._stateManager.getStatus();
        } finally {
            chatCancellation.dispose();
            this._activeCopilotContext = null;
        }
    }

    /**
     * Pause execution at the next node boundary.
     * Sets a cooperative flag that the main loop checks before each node.
     */
    pause(): void {
        if (this._stateManager.getStatus() === ExecutionStatus.Running) {
            this._pauseRequested = true;
        }
    }

    /**
     * Resume a workflow that was halted by pause().
     * Resolves the pause promise so the main loop can continue.
     * Returns true if the workflow was actually resumed, false if it wasn't paused.
     */
    resume(): boolean {
        if (this._stateManager.getStatus() !== ExecutionStatus.Paused) {
            return false;
        }
        this._stateManager.setStatus(ExecutionStatus.Running);
        this.observer.onStatusChange(ExecutionStatus.Running);
        this.observer.onNotification('info', 'Workflow resumed.');
        this.notifyExecutionUpdate();

        if (this._pauseResolver) {
            const resolver = this._pauseResolver;
            this._pauseResolver = null;
            this._pausePromise = null;
            resolver();
        }
        return true;
    }

    /**
     * Stop execution
     */
    stop(): void {
        this._abortController?.abort();
        this._stateManager.complete(ExecutionStatus.Stopped);
        this.observer.onStatusChange(ExecutionStatus.Stopped);
        this.observer.onNotification('info', 'Workflow stopped.');

        // If paused, resolve the pause promise so execution can exit
        if (this._pauseResolver) {
            const resolver = this._pauseResolver;
            this._pauseResolver = null;
            this._pausePromise = null;
            resolver();
        }
    }

    /**
     * Get execution context for UI updates
     */
    getExecutionContext(): ExecutionContext {
        return this._stateManager.context;
    }

    /**
     * Get the execution summary (generated by the End node).
     */
    getExecutionSummary(): string | undefined {
        return this._stateManager.get('executionSummary') as string | undefined;
    }

    /**
     * Validate a workflow and return errors.
     */
    validate(workflow: Workflow): ValidationError[] {
        return validateWorkflow(workflow);
    }

    /**
     * Export the current execution's logs as a formatted text string.
     */
    exportLogs(workflowName: string): string {
        const exec = this._stateManager.context;
        return exportExecutionLogs(
            exec.nodeRecords,
            workflowName,
            exec.status,
            exec.startTime,
            exec.endTime
        );
    }

    // ---- Private execution logic ----

    private async execute(workflow: Workflow, chatContext?: ChatRequestContext, workspaceRoot?: string): Promise<void> {
        this._stateManager.initialize(workflow.initialState);
        // Initialize all node execution counts to 0 so every node shows a counter
        this._stateManager.initializeNodeExecutionCounts(workflow.nodes.map(n => n.id));
        this._abortController = new AbortController();
        if (workspaceRoot) {this._workspaceRoot = workspaceRoot;}
        this.observer.onStatusChange(ExecutionStatus.Running);

        if (chatContext) {
            if (chatContext.prompt) {
                this._stateManager.set('chatPrompt', chatContext.prompt);
            }
            if (chatContext.references && chatContext.references.length > 0) {
                const refUris = chatContext.references.map(r => {
                    if ('documentUri' in r) {
                        return r.documentUri || null;
                    }
                    return null;
                }).filter(Boolean);
                if (refUris.length > 0) {
                    this._stateManager.set('chatReferences', refUris);
                }
            }
        }

        const startNode = workflow.nodes.find(n => n.type === NodeType.Start);
        if (!startNode) {
            this.observer.onLog('✗ No Start node found in workflow.');
            this.observer.onNotification('error', 'No Start node found in workflow.');
            this._stateManager.complete(ExecutionStatus.Failed);
            this.observer.onStatusChange(ExecutionStatus.Failed);
            return;
        }

        try {
            this.observer.onLog(`✓ Start node: ${startNode.id}`);
            this._stateManager.markStartCompleted(startNode.id, this.getNodeLabel(startNode));
            this.notifyExecutionUpdate();

            let currentNodeIds = this.getAllNextExecutableNodes(startNode.id, workflow);
            let hadFailure = false;

            while (currentNodeIds.length > 0 && !this.isAborted()) {
                // Check for cooperative pause request before processing next node batch
                if (this._pauseRequested) {
                    this._pauseRequested = false;
                    this._stateManager.setStatus(ExecutionStatus.Paused);
                    this.observer.onStatusChange(ExecutionStatus.Paused);
                    this.observer.onNotification('info', 'Workflow paused.');
                    this.notifyExecutionUpdate();

                    // Wait until resume() is called
                    this._pausePromise = new Promise((resolve) => {
                        this._pauseResolver = resolve;
                    });
                    await this._pausePromise;
                    // resume() already set status back to Running and sent notifications
                    continue;
                }

                const nextNodeIds: string[] = [];
                const skippedNodeIds = new Set<string>();

                for (const nodeId of currentNodeIds) {
                    if (this.isAborted()) {break;}
                    // Also check pause flag before each individual node
                    if (this._pauseRequested) {break;}

                    const node = workflow.nodes.find(n => n.id === nodeId);
                    if (!node) {continue;}

                    const label = this.getNodeLabel(node);
                    this.observer.onLog(`  ⠋ Running ${nodeId} (${label})...`);

                    // Increment execution count for this node entry
                    const execCount = this._stateManager.incrementNodeExecutionCount(nodeId);

                    // Infinite loop protection: abort if a node has been executed too many times
                    if (execCount > WorkflowExecutor.MAX_NODE_EXECUTIONS) {
                        const label = this.getNodeLabel(node);
                        this.observer.onLog(`\n⚠ Loop protection triggered: node ${nodeId} (${label}) exceeded max execution count (${WorkflowExecutor.MAX_NODE_EXECUTIONS}).`);
                        this.observer.onLog(`   This likely indicates an infinite loop in the workflow.`);
                        this._stateManager.addError(nodeId, `Node exceeded max execution count (${WorkflowExecutor.MAX_NODE_EXECUTIONS}). Workflow aborted to prevent infinite loop.`);
                        this.observer.onNotification('error', `Infinite loop detected: node ${nodeId} executed ${execCount} times.`);
                        hadFailure = true;
                        // Clear next nodes to exit the while loop immediately
                        currentNodeIds = [];
                        break;
                    }

                    // Single deep call: processNode handles record creation, timing, status, and errors
                    const result = await this._stateManager.processNode(nodeId, label, async () => {
                        this.notifyExecutionUpdate();
                        return this.executeNodeInternal(node, workflow);
                    });

                    this.notifyExecutionUpdate();

                    if (result.success) {
                        this.observer.onLog(`  ✓ ${nodeId} completed`);
                        const children = this.getNextExecutableNodes(nodeId, node, workflow, result.branchResult);
                        nextNodeIds.push(...children);

                        if (result.branchResult !== undefined) {
                            const allChildren = this.getAllNextExecutableNodes(nodeId, workflow);
                            const takenTargets = new Set(children);
                            for (const childId of allChildren) {
                                if (!takenTargets.has(childId)) {
                                    skippedNodeIds.add(childId);
                                }
                            }
                        }
                    } else {
                        this.observer.onLog(`  ✗ ${nodeId} failed`);
                        hadFailure = true;
                    }
                }

                for (const skipId of skippedNodeIds) {
                    this.markSkipped(skipId, workflow);
                }

                currentNodeIds = nextNodeIds;
            }

            if (!this.isAborted()) {
                if (hadFailure) {
                    this._stateManager.complete(ExecutionStatus.Failed);
                    this.observer.onStatusChange(ExecutionStatus.Failed);
                    this.observer.onLog('');
                    this.observer.onLog('✗ Workflow finished with errors.');
                    this.observer.onNotification('warning', 'Workflow finished with errors.');
                } else {
                    this._stateManager.complete(ExecutionStatus.Completed);
                    this.observer.onStatusChange(ExecutionStatus.Completed);
                    this.observer.onLog('');
                    this.observer.onLog('✓ Workflow completed successfully!');
                    this.observer.onNotification('info', 'Workflow completed successfully.');
                }
            }
        } catch (error) {
            this._stateManager.complete(ExecutionStatus.Failed);
            this.observer.onStatusChange(ExecutionStatus.Failed);
            this.observer.onLog(`\n✗ Workflow failed: ${error}`);
            this.observer.onNotification('error', `Workflow failed: ${error}`);
        }

        this._abortController = null;
        this.notifyExecutionUpdate();
    }

    /**
     * Node business logic only — lifecycle (timing, status, records) is handled
     * by StateManager.processNode().
     */
    private async executeNodeInternal(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        switch (node.type) {
            case NodeType.Start:
                return { success: true };

            case NodeType.End:
                this.executeEndNode(node);
                return { success: true };

            case NodeType.Agent:
                return { success: await this.executeAgentNode(node, workflow, this._workspaceRoot) };

            case NodeType.Condition:
                return this.executeConditionNode(node, workflow);

            case NodeType.HumanApproval:
                return this.executeHumanApprovalNode(node);

            case NodeType.Delay:
                return this.executeDelayNode(node);

            case NodeType.Loop:
                return this.executeLoopNode(node, workflow);

            default:
                return { success: true };
        }
    }

    private async executeAgentNode(node: Node, _workflow: Workflow, workspaceRoot: string): Promise<boolean> {
        const data = node.data as AgentNodeData;
        const record = this._stateManager.getNodeRecord(node.id);

        const agentPath = this.resolveAgentPath(data.agent, workspaceRoot);
        this.observer.onLog(`     → Agent: ${data.agent} (${agentPath})`);
        if (data.model) {
            this.observer.onLog(`     → Model: ${data.model}`);
        }

        const copilotContext = this._activeCopilotContext;
        if (!copilotContext) {
            const message = 'Agent nodes require execution from the @workflow Copilot Chat participant.';
            this._stateManager.addError(node.id, message);
            this.observer.onLog(`     ✗ ${message}`);
            throw new Error(message);
        }

        const maxRetries = data.retries || 0;
        let lastError = '';

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (this.isAborted()) {
                return false;
            }

            const result = await this._agentInvoker.invokeAgent(
                agentPath,
                data.prompt || '',
                { ...this._stateManager.state },
                data.timeout || 120,
                data.model,
                {
                    ...copilotContext,
                    workflowAbortSignal: this._abortController?.signal
                },
                record,
                (msg: string) => this.observer.onLog(`     ${msg}`),
                (msg: string) => this.observer.onProgress(msg),
                data.stateWrites
            );

            if (result.success) {
                this.observer.onLog('');
                this.observer.onStatusChange(ExecutionStatus.Running);

                if (result.filesModified && result.filesModified.length > 0) {
                    this.observer.onLog(`     → Files modified: ${result.filesModified.join(', ')}`);
                }

                const outputPreview = result.output.length > 500
                    ? result.output.substring(0, 500) + '...\n     (output truncated, see Output panel for full response)'
                    : result.output;
                this.observer.onLog(`     → Agent output:\n${outputPreview.split('\n').join('\n')}`);

                this._stateManager.set(`${node.id}_output`, result.output);
                this._stateManager.set(`${node.id}_success`, true);

                if (data.stateWrites) {
                    for (const mapping of data.stateWrites) {
                        const value = this.extractValue(result.output, mapping.source);
                        this._stateManager.set(mapping.target, value);
                    }
                }

                return true;
            }

            lastError = result.output;
            this._stateManager.addLog(node.id, `Attempt ${attempt + 1} failed: ${lastError}`);
            this.observer.onLog('');
            this.observer.onLog(`     ✗ Agent failed (attempt ${attempt + 1}): ${lastError}`);
        }

        this._stateManager.set(`${node.id}_success`, false);
        this._stateManager.addError(node.id, `All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        this.observer.onLog(`     ✗ All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        throw new Error(`All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
    }

    private async executeConditionNode(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        const data = node.data as ConditionNodeData;
        const record = this._stateManager.getNodeRecord(node.id);

        const copilotContext = this._activeCopilotContext;
        if (!copilotContext) {
            const message = 'Condition nodes require execution from the @workflow Copilot Chat participant.';
            this._stateManager.addError(node.id, message);
            this.observer.onLog(`     ✗ ${message}`);
            throw new Error(message);
        }

        // Build the system prompt that forces a true/false response
        const systemPrompt = 'You are a workflow routing agent. Review the provided context and decide which branch to take. Respond with ONLY the word "true" or "false" (lowercase, no quotes, no extra text).';
        const fullPrompt = data.prompt
            ? `${systemPrompt}\n\nYour routing instructions:\n${data.prompt}`
            : systemPrompt;

        this.observer.onLog(`     → Condition: ${data.prompt || '(no prompt)'}`);
        if (data.model) {
            this.observer.onLog(`     → Model: ${data.model}`);
        }

        const result = await this._agentInvoker.invokeAgent(
            '', // no agent file needed for condition nodes
            fullPrompt,
            { ...this._stateManager.state },
            120, // default timeout
            data.model,
            {
                ...copilotContext,
                workflowAbortSignal: this._abortController?.signal
            },
            record,
            (msg: string) => this.observer.onLog(`     ${msg}`),
            (msg: string) => this.observer.onProgress(msg)
        );

        if (!result.success) {
            this._stateManager.addError(node.id, `Condition agent failed: ${result.output}`);
            this.observer.onLog(`     ✗ Condition agent failed: ${result.output}`);
            throw new Error(`Condition agent failed: ${result.output}`);
        }

        // Parse the true/false response
        const rawOutput = result.output.trim();
        const lower = rawOutput.toLowerCase();

        // Detect agent errors in output — if the agent returned an error message
        // instead of a proper true/false, fail the node rather than defaulting to false
        if (this.isConditionAgentError(rawOutput)) {
            const errorMessage = `Condition agent returned an error instead of true/false: ${rawOutput.substring(0, 200)}`;
            this._stateManager.addError(node.id, errorMessage);
            this.observer.onLog(`     ✗ ${errorMessage}`);
            throw new Error(errorMessage);
        }

        // First try exact match for clean responses
        const exactTrue = lower === 'true' || lower === 'yes' || lower === '1';
        const exactFalse = lower === 'false' || lower === 'no' || lower === '0';
        if (exactTrue || exactFalse) {
            const branchResult = exactTrue;
            this._stateManager.addLog(node.id, `Condition agent responded: ${rawOutput} → ${branchResult}`);
            this._stateManager.set(`${node.id}_result`, branchResult);
            this._stateManager.set(`${node.id}_output`, result.output);
            const outgoingEdges = workflow.edges.filter(e => e.source === node.id);
            for (const edge of outgoingEdges) {
                const isTruePath = this.isTrueEdge(edge);
                if ((branchResult && isTruePath) || (!branchResult && !isTruePath)) {
                    this._stateManager.addLog(node.id, `Taking branch: ${edge.label || (branchResult ? 'True' : 'False')}`);
                }
            }
            return { success: true, branchResult };
        }

        // Fallback: extract true/false from prose responses (e.g. "Based on my review... true")
        // Match standalone words only to avoid false positives in substrings
        const matchTrue = /\btrue\b|\byes\b|\b1\b/i.exec(rawOutput);
        const matchFalse = /\bfalse\b|\bno\b|\b0\b/i.exec(rawOutput);

        let branchResult: boolean | undefined;
        if (matchTrue && (!matchFalse || matchTrue.index <= matchFalse.index)) {
            branchResult = true;
        } else if (matchFalse) {
            branchResult = false;
        }

        if (branchResult === undefined) {
            const errorMessage = `Condition agent did not return a valid true/false response. Got: "${rawOutput.substring(0, 200)}"`;
            this._stateManager.addError(node.id, errorMessage);
            this.observer.onLog(`     ✗ ${errorMessage}`);
            throw new Error(errorMessage);
        }

        this._stateManager.addLog(node.id, `Condition agent responded: ${rawOutput} → ${branchResult}`);
        this._stateManager.set(`${node.id}_result`, branchResult);
        this._stateManager.set(`${node.id}_output`, result.output);

        const outgoingEdges = workflow.edges.filter(e => e.source === node.id);
        for (const edge of outgoingEdges) {
            const isTruePath = this.isTrueEdge(edge);
            if ((branchResult && isTruePath) || (!branchResult && !isTruePath)) {
                this._stateManager.addLog(node.id, `Taking branch: ${edge.label || (branchResult ? 'True' : 'False')}`);
            }
        }

        return { success: true, branchResult };
    }

    private async executeHumanApprovalNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as HumanApprovalNodeData;
        this._stateManager.setStatus(ExecutionStatus.Paused);
        this.notifyExecutionUpdate();

        const approved = await this.observer.requestApproval(data.message);
        this._stateManager.set(`${node.id}_approved`, approved);
        this._stateManager.addLog(node.id, `Approval result: ${approved ? 'Approved' : 'Rejected'}`);

        return { success: true, branchResult: approved };
    }

    private async executeDelayNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as DelayNodeData;
        this._stateManager.addLog(node.id, `Waiting ${data.duration} seconds...`);

        const start = Date.now();
        while (Date.now() - start < data.duration * 1000) {
            if (this.isAborted()) {throw new Error('Aborted during delay');}
            if (this._pauseRequested) {return { success: true };}
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return { success: true };
    }

    private executeLoopNode(node: Node, _workflow: Workflow): NodeExecutionResult {
        const data = node.data as LoopNodeData;
        const stateKey = 'loop_iterationCount';

        let count = this._stateManager.get(stateKey) as number | undefined;
        if (count === undefined) {
            count = 0;
        }

        let shouldContinue = false;

        if (data.mode === 'count') {
            shouldContinue = count < data.maxIterations;
        } else {
            // Condition mode: check expression AND safety net
            if (count >= data.maxIterations) {
                shouldContinue = false;
                this._stateManager.addLog(node.id, `Max iterations (${data.maxIterations}) reached, exiting loop`);
            } else if (data.expression) {
                try {
                    const result = ConditionEvaluator.evaluate(data.expression, this._stateManager.state);
                    shouldContinue = !!result;
                } catch (e) {
                    this._stateManager.addError(node.id, `Loop condition evaluation failed: ${e}`);
                    shouldContinue = false;
                }
            } else {
                shouldContinue = false;
            }
        }

        if (shouldContinue) {
            count++;
            this._stateManager.set(stateKey, count);
            this._stateManager.addLog(node.id, `Loop iteration ${count}/${data.maxIterations} — entering body`);
            return { success: true, branchResult: true }; // body edge
        } else {
            this._stateManager.addLog(node.id, `Loop exiting after ${count} iteration(s)`);
            return { success: true, branchResult: false }; // exit edge
        }
    }

    private executeEndNode(node: Node): void {
        const data = node.data as EndNodeData;
        if (data.summary === false) {
            return;
        }

        const summary = this.buildExecutionSummary();
        this._stateManager.set('executionSummary', summary);
        this._stateManager.addLog(node.id, summary);

        for (const line of summary.split('\n')) {
            this.observer.onLog(line);
        }
    }

    private buildExecutionSummary(workflowName?: string): string {
        const execContext = this._stateManager.context;
        const nodeRecords = execContext.nodeRecords;

        const lines: string[] = [];
        lines.push('');
        lines.push('═══ Workflow Execution Summary ═══');
        lines.push(`Workflow: ${workflowName || 'unknown'}`);

        const endTime = execContext.endTime || Date.now();
        if (execContext.startTime) {
            const duration = endTime - execContext.startTime;
            lines.push(`Duration: ${this.formatDuration(duration)}`);
        }

        lines.push(`Status: ${execContext.status}`);
        lines.push('');
        lines.push('Nodes Executed:');

        const statusIcon: Record<NodeStatus, string> = {
            [NodeStatus.Waiting]: '⏳',
            [NodeStatus.Running]: '▶',
            [NodeStatus.Completed]: '✓',
            [NodeStatus.Failed]: '✗',
            [NodeStatus.Paused]: '⏸',
            [NodeStatus.Skipped]: '⊘'
        };

        for (const [nodeId, record] of nodeRecords) {
            const icon = statusIcon[record.status] || '?';
            const label = record.nodeName || nodeId;
            const durationStr = record.duration ? ` (${this.formatDuration(record.duration)})` : '';
            lines.push(`  ${icon} ${label}${durationStr}`);

            const agentOutput = this._stateManager.get(`${nodeId}_output`);
            if (agentOutput && typeof agentOutput === 'string') {
                const preview = (agentOutput as string).length > 200
                    ? (agentOutput as string).substring(0, 200) + '...'
                    : agentOutput;
                lines.push(`    Output: ${preview}`);
            }
        }

        lines.push('');
        lines.push('═══════════════════════════════════');

        return lines.join('\n');
    }

    // ---- Graph traversal helpers ----

    private getNextNodes(nodeId: string, node: Node, workflow: Workflow, branchResult?: boolean): string[] {
        const allEdges = workflow.edges.filter(e => e.source === nodeId);

        if (branchResult !== undefined && (node.type === NodeType.Condition || node.type === NodeType.HumanApproval || node.type === NodeType.Loop)) {
            return allEdges
                .filter(e => this.edgeMatchesBranch(e, branchResult))
                .map(e => e.target);
        }

        return allEdges.map(e => e.target);
    }

    private getAllNextNodes(nodeId: string, workflow: Workflow): string[] {
        return workflow.edges
            .filter(e => e.source === nodeId)
            .map(e => e.target);
    }

    /**
     * Get next executable nodes, skipping annotation nodes.
     * Annotation nodes are transparent to execution — if an edge targets
     * an annotation node, traversal continues through it to the next executable node.
     */
    private getNextExecutableNodes(nodeId: string, node: Node, workflow: Workflow, branchResult?: boolean): string[] {
        const targets = this.getNextNodes(nodeId, node, workflow, branchResult);
        // For each target that is an annotation node, transparently traverse through it
        const resolved: string[] = [];
        for (const t of targets) {
            const targetNode = workflow.nodes.find(n => n.id === t);
            if (targetNode && isAnnotationNode(targetNode.type)) {
                // Recursively resolve through annotation nodes
                const through = this.getNextExecutableNodes(t, targetNode, workflow);
                resolved.push(...through);
            } else {
                resolved.push(t);
            }
        }
        return resolved;
    }

    private getAllNextExecutableNodes(nodeId: string, workflow: Workflow): string[] {
        const targets = this.getAllNextNodes(nodeId, workflow);
        const resolved: string[] = [];
        for (const t of targets) {
            const targetNode = workflow.nodes.find(n => n.id === t);
            if (targetNode && isAnnotationNode(targetNode.type)) {
                const through = this.getAllNextExecutableNodes(t, workflow);
                resolved.push(...through);
            } else {
                resolved.push(t);
            }
        }
        return resolved;
    }

    private isTrueEdge(edge: { label?: string }): boolean {
        const label = edge.label?.toLowerCase();
        return label === 'true' || label === 'pass' || label === 'approve' || label === 'body';
    }

    private edgeMatchesBranch(edge: { label?: string }, branchResult: boolean): boolean {
        if (branchResult) {
            return this.isTrueEdge(edge);
        } else {
            const label = edge.label?.toLowerCase();
            return label === 'false' || label === 'fail' || label === 'reject' || label === 'exit' || !label;
        }
    }

    private markSkipped(nodeId: string, workflow: Workflow): void {
        const existing = this._stateManager.getNodeRecord(nodeId);
        if (existing && (existing.status === NodeStatus.Skipped || existing.status === NodeStatus.Completed || existing.status === NodeStatus.Failed)) {
            return;
        }

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) {
            return;
        }

        this._stateManager.skipNode(nodeId, this.getNodeLabel(node));
        this.observer.onLog(`  ⊘ ${nodeId} skipped (untaken branch)`);
        this.notifyExecutionUpdate();

        const children = this.getAllNextExecutableNodes(nodeId, workflow);
        for (const childId of children) {
            this.markSkipped(childId, workflow);
        }
    }

    // ---- Private utilities ----

    private getNodeLabel(node: Node): string {
        const d = node.data as unknown as Record<string, string>;
        return d.label || d.agent || d.message || node.id;
    }

    private resolveAgentPath(agentName: string, workspaceRoot: string): string {
        const agentsDir = path.join(workspaceRoot, '.github', 'agents');
        const agentFile = path.join(agentsDir, `${agentName}.agent.md`);

        if (fs.existsSync(agentFile)) {
            return agentFile;
        }
        if (fs.existsSync(agentName)) {
            return agentName;
        }
        const relativePath = path.join(workspaceRoot, agentName);
        if (fs.existsSync(relativePath)) {
            return relativePath;
        }
        return agentFile;
    }

    private isAborted(): boolean {
        return this._abortController?.signal.aborted ?? false;
    }

    private formatDuration(ms: number): string {
        if (ms < 1000) {
            return `${ms}ms`;
        }
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) {
            return `${seconds}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }

    private extractValue(output: string, field: string): unknown {
        try {
            const parsed = JSON.parse(output);
            return parsed[field];
        } catch {
            return output;
        }
    }

    /**
     * Detect if a condition agent's output is an error message rather than a valid true/false response.
     * When the condition agent fails (network error, timeout, etc.), it may return an error message
     * wrapped in its output instead of throwing — we need to detect this and fail the node.
     */
    private isConditionAgentError(output: string): boolean {
        const trimmed = output.trim();
        // Check for common error patterns in agent output
        const errorPatterns = [
            /^agent error:/i,
            /^error:/i,
            /^failed:/i,
            /network request aborted/i,
            /request failed/i,
            /connection refused/i,
            /etimedout/i,
            /econnreset/i,
        ];
        return errorPatterns.some(pattern => pattern.test(trimmed));
    }

    private notifyExecutionUpdate(): void {
        const nodeStatuses: Record<string, { status: NodeStatus; startTime?: number; endTime?: number; duration?: number }> = {};
        for (const [id, record] of this._stateManager.context.nodeRecords) {
            nodeStatuses[id] = {
                status: record.status,
                startTime: record.startTime,
                endTime: record.endTime,
                duration: record.duration
            };
        }
        const event: ExecutionStateChangeEvent = {
            overall: this._stateManager.getStatus(),
            currentNodeId: this._stateManager.context.currentNodeId,
            nodeStatuses,
            nodeExecutionCounts: this._stateManager.getNodeExecutionCounts()
        };
        for (const listener of this._executionStateListeners) {
            listener(event);
        }
    }
}
