import * as fs from 'fs';
import * as path from 'path';
import {
    Workflow, Node, NodeType,
    ExecutionStatus, NodeStatus,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData, EndNodeData,
    WorkflowState, ExecutionContext, NodeExecutionRecord
} from '../models/workflow';
import { StateManager } from './stateManager';
import { ConditionEvaluator } from './conditionEvaluator';
import { CopilotSubagentExecutionContext, IAgentInvoker } from './executionContext';
import { ExecutionObserver } from './executionObserver.interface';
import { validateWorkflow } from '../utils/workflowValidator';

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

    constructor(private readonly observer: ExecutionObserver, agentInvoker?: IAgentInvoker) {
        this._stateManager = new StateManager();
        this._agentInvoker = agentInvoker ?? null as any; // production code must inject AgentInvoker
    }

    /**
     * Subscribe to execution state changes.
     */
    onDidChangeExecutionState(listener: ExecutionStateChangeListener): () => void {
        this._executionStateListeners.push(listener);
        return () => {
            const idx = this._executionStateListeners.indexOf(listener);
            if (idx >= 0) this._executionStateListeners.splice(idx, 1);
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
     * Pause execution
     */
    pause(): void {
        if (this._stateManager.getStatus() === ExecutionStatus.Running) {
            this._stateManager.setStatus(ExecutionStatus.Paused);
            this.observer.onStatusChange(ExecutionStatus.Paused);
            this.observer.onNotification('info', 'Workflow paused.');
        }
    }

    /**
     * Stop execution
     */
    stop(): void {
        this._abortController?.abort();
        this._stateManager.complete(ExecutionStatus.Stopped);
        this.observer.onStatusChange(ExecutionStatus.Stopped);
        this.observer.onNotification('info', 'Workflow stopped.');
    }

    /**
     * Get execution context for UI updates
     */
    getExecutionContext(): ExecutionContext {
        return this._stateManager.context;
    }

    /**
     * Get state manager (for testing)
     */
    getStateManager(): StateManager {
        return this._stateManager;
    }

    /**
     * Get the execution summary (generated by the End node).
     */
    getExecutionSummary(): string | undefined {
        return this._stateManager.get('executionSummary') as string | undefined;
    }

    // ---- Private execution logic ----

    private async execute(workflow: Workflow, chatContext?: ChatRequestContext, workspaceRoot?: string): Promise<void> {
        this._stateManager.initialize();
        this._abortController = new AbortController();
        if (workspaceRoot) this._workspaceRoot = workspaceRoot;
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
            this._stateManager.createNodeRecord(startNode.id, NodeStatus.Completed, this.getNodeLabel(startNode));
            this._stateManager.setCurrentNode(startNode.id);
            this.notifyExecutionUpdate();

            let currentNodeIds = this.getAllNextNodes(startNode.id, workflow);
            let hadFailure = false;

            while (currentNodeIds.length > 0 && !this.isAborted()) {
                const nextNodeIds: string[] = [];
                const skippedNodeIds = new Set<string>();

                for (const nodeId of currentNodeIds) {
                    if (this.isAborted()) break;

                    const node = workflow.nodes.find(n => n.id === nodeId);
                    if (!node) continue;

                    this._stateManager.setCurrentNode(nodeId);
                    this._stateManager.createNodeRecord(nodeId, NodeStatus.Waiting, this.getNodeLabel(node));
                    this.notifyExecutionUpdate();

                    const label = this.getNodeLabel(node);
                    this.observer.onLog(`  ⠋ Running ${nodeId} (${label})...`);
                    const result = await this.executeNode(node, workflow);
                    this.notifyExecutionUpdate();

                    if (result.success) {
                        this.observer.onLog(`  ✓ ${nodeId} completed`);
                        const children = this.getNextNodes(nodeId, node, workflow, result.branchResult);
                        nextNodeIds.push(...children);

                        if (result.branchResult !== undefined) {
                            const allChildren = this.getAllNextNodes(nodeId, workflow);
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

    private async executeNode(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        this._stateManager.updateNodeStatus(node.id, NodeStatus.Running);
        this._stateManager.startNode(node.id);

        try {
            switch (node.type) {
                case NodeType.Start:
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return { success: true };

                case NodeType.End:
                    this.executeEndNode(node);
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return { success: true };

                case NodeType.Agent:
                    return { success: await this.executeAgentNode(node, workflow, this._workspaceRoot) };

                case NodeType.Condition:
                    return this.executeConditionNode(node, workflow);

                case NodeType.HumanApproval:
                    return this.executeHumanApprovalNode(node);

                case NodeType.Delay:
                    return this.executeDelayNode(node);

                case NodeType.Condition:
                    return this.executeConditionNode(node, workflow);

                case NodeType.HumanApproval:
                    return this.executeHumanApprovalNode(node);

                case NodeType.Delay:
                    return this.executeDelayNode(node);

                default:
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return { success: true };
            }
        } catch (error) {
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            this._stateManager.addError(node.id, String(error));
            return { success: false };
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
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            this.observer.onLog(`     ✗ ${message}`);
            return false;
        }

        const maxRetries = data.retries || 0;
        let lastError = '';

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (this.isAborted()) return false;

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
                (msg: string) => this.observer.onProgress(msg)
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

                this._stateManager.endNode(node.id, NodeStatus.Completed);
                return true;
            }

            lastError = result.output;
            this._stateManager.addLog(node.id, `Attempt ${attempt + 1} failed: ${lastError}`);
            this.observer.onLog('');
            this.observer.onLog(`     ✗ Agent failed (attempt ${attempt + 1}): ${lastError}`);
        }

        this._stateManager.endNode(node.id, NodeStatus.Failed);
        this._stateManager.addError(node.id, `All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        this.observer.onLog(`     ✗ All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        return false;
    }

    private async executeConditionNode(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        const data = node.data as ConditionNodeData;
        const result = ConditionEvaluator.evaluate(data.expression, this._stateManager.state);

        this._stateManager.addLog(node.id, `Condition evaluated to: ${result}`);
        this._stateManager.set(`${node.id}_result`, result);

        const outgoingEdges = workflow.edges.filter(e => e.source === node.id);
        for (const edge of outgoingEdges) {
            const isTruePath = this.isTrueEdge(edge);
            if ((result && isTruePath) || (!result && !isTruePath)) {
                this._stateManager.addLog(node.id, `Taking branch: ${edge.label || (result ? 'True' : 'False')}`);
            }
        }

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return { success: true, branchResult: result };
    }

    private async executeHumanApprovalNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as HumanApprovalNodeData;
        this._stateManager.updateNodeStatus(node.id, NodeStatus.Paused);
        this.notifyExecutionUpdate();

        const approved = await this.observer.requestApproval(data.message);
        this._stateManager.set(`${node.id}_approved`, approved);
        this._stateManager.addLog(node.id, `Approval result: ${approved ? 'Approved' : 'Rejected'}`);

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return { success: true, branchResult: approved };
    }

    private async executeDelayNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as DelayNodeData;
        this._stateManager.addLog(node.id, `Waiting ${data.duration} seconds...`);

        const start = Date.now();
        while (Date.now() - start < data.duration * 1000) {
            if (this.isAborted()) return { success: false };
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return { success: true };
    }

    private executeEndNode(node: Node): void {
        const data = node.data as EndNodeData;
        if (data.summary === false) return;

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

        if (branchResult !== undefined && (node.type === NodeType.Condition || node.type === NodeType.HumanApproval)) {
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

    private isTrueEdge(edge: { label?: string }): boolean {
        const label = edge.label?.toLowerCase();
        return label === 'true' || label === 'pass' || label === 'approve';
    }

    private edgeMatchesBranch(edge: { label?: string }, branchResult: boolean): boolean {
        if (branchResult) {
            return this.isTrueEdge(edge);
        } else {
            const label = edge.label?.toLowerCase();
            return label === 'false' || label === 'fail' || label === 'reject' || !label;
        }
    }

    private markSkipped(nodeId: string, workflow: Workflow): void {
        const existing = this._stateManager.getNodeRecord(nodeId);
        if (existing && (existing.status === NodeStatus.Skipped || existing.status === NodeStatus.Completed || existing.status === NodeStatus.Failed)) {
            return;
        }

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) return;

        this._stateManager.createNodeRecord(nodeId, NodeStatus.Skipped, this.getNodeLabel(node));
        this.observer.onLog(`  ⊘ ${nodeId} skipped (untaken branch)`);
        this.notifyExecutionUpdate();

        const children = this.getAllNextNodes(nodeId, workflow);
        for (const childId of children) {
            this.markSkipped(childId, workflow);
        }
    }

    // ---- Private utilities ----

    private getNodeLabel(node: Node): string {
        const d = node.data as any;
        return d.label || d.agent || d.message || node.id;
    }

    private resolveAgentPath(agentName: string, workspaceRoot: string): string {
        const agentsDir = path.join(workspaceRoot, '.github', 'agents');
        const agentFile = path.join(agentsDir, `${agentName}.agent.md`);

        if (fs.existsSync(agentFile)) return agentFile;
        if (fs.existsSync(agentName)) return agentName;
        const relativePath = path.join(workspaceRoot, agentName);
        if (fs.existsSync(relativePath)) return relativePath;
        return agentFile;
    }

    private isAborted(): boolean {
        return this._abortController?.signal.aborted ?? false;
    }

    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
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
            nodeStatuses
        };
        for (const listener of this._executionStateListeners) {
            listener(event);
        }
    }
}
