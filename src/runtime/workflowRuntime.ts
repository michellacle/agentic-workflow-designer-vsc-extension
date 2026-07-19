import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    Workflow, Node, NodeType,
    ExecutionStatus, NodeStatus,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData, EndNodeData
} from '../models/workflow';
import { StateManager } from './stateManager';
import { ConditionEvaluator } from './conditionEvaluator';
import { AgentInvoker, CopilotSubagentExecutionContext } from './agentInvoker';
import { RunHistoryManager, RunRecord } from './runHistory';
import { validateWorkflow } from '../utils/workflowValidator';

/**
 * Node execution result with optional branch information.
 * For branching nodes (Condition, HumanApproval), `branchResult` indicates
 * which path was taken so the runtime can follow only the matching edge.
 */
export interface NodeExecutionResult {
    success: boolean;
    /** True = follow True/Approve edge, False = follow False/Reject edge. Undefined means follow all edges. */
    branchResult?: boolean;
}

/**
 * Context from the Copilot Chat request, passed to the workflow so agent
 * nodes can reference the user's original prompt and any file/selection
 * references.
 */
export interface ChatRequestContext {
    /** The user's prompt text from the chat message */
    prompt?: string;
    /** File URIs, selections, or other references attached to the chat message */
    references?: readonly vscode.ChatPromptReference[];
}

/**
 * Main workflow execution engine
 */
export class WorkflowRuntime implements vscode.Disposable {
    private _stateManager: StateManager;
    private _agentInvoker: AgentInvoker;
    private _runHistory: RunHistoryManager;
    private _disposables: vscode.Disposable[] = [];
    private _currentWorkflow: Workflow | null = null;
    private _currentFileUri: vscode.Uri | null = null;
    private _abortController: AbortController | null = null;
    private _activeCopilotContext: CopilotSubagentExecutionContext | null = null;
    private _statusBarItem: vscode.StatusBarItem;
    private _outputChannel: vscode.OutputChannel;
    private _maxLoopIterations: number = 100;
    private readonly _onDidChangeExecutionState = new vscode.EventEmitter<any>();

    public readonly onDidChangeExecutionState = this._onDidChangeExecutionState.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._stateManager = new StateManager();
        this._agentInvoker = new AgentInvoker();
        this._runHistory = new RunHistoryManager(context);
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.text = '$$(eye) Workflow: Idle';
        this._statusBarItem.tooltip = 'Workflow execution status';
        this._outputChannel = vscode.window.createOutputChannel('Workflow Executor');
        this._disposables.push(this._statusBarItem, this._outputChannel);
    }

    /**
     * Set the current workflow being edited
     */
    setCurrentWorkflow(workflow: Workflow, uri: vscode.Uri): void {
        this._currentWorkflow = workflow;
        this._currentFileUri = uri;
    }

    /**
     * Load a workflow directly from a .workflow.yaml file on disk.
     * Returns true if successfully loaded.
     */
    async loadWorkflowFromFile(uri: vscode.Uri): Promise<boolean> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const yamlStr = Buffer.from(content).toString('utf-8');
            const { yamlToWorkflow } = await import('../utils/yamlSerializer');
            const workflow = yamlToWorkflow(yamlStr);
            this._currentWorkflow = workflow;
            this._currentFileUri = uri;
            return true;
        } catch (error) {
            this.log(`Failed to load workflow from ${uri.fsPath}: ${error}`);
            return false;
        }
    }

    /**
     * Try to discover and load a workflow file from the active editor or chat references.
     */
    async tryLoadWorkflowFromContext(chatContext?: ChatRequestContext): Promise<boolean> {
        // First check if we already have a workflow
        if (this._currentWorkflow && this._currentFileUri) {
            return true;
        }

        // Try to find a workflow file in chat references
        if (chatContext?.references) {
            for (const ref of chatContext.references) {
                if ('documentUri' in ref) {
                    const uri = ref.documentUri as vscode.Uri | string;
                    const uriStr = typeof uri === 'string' ? uri : uri.toString();
                    if (uriStr.endsWith('.workflow.yaml')) {
                        const fileUri = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
                        const loaded = await this.loadWorkflowFromFile(fileUri);
                        if (loaded) return true;
                    }
                }
            }
        }

        // Try the active text editor (plain YAML view)
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.workflow.yaml')) {
            return await this.loadWorkflowFromFile(activeEditor.document.uri);
        }

        // Try the active custom editor (visual designer) - check tab groups
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.isActive && tab.input instanceof vscode.TabInputCustom && tab.input.uri.fsPath.endsWith('.workflow.yaml')) {
                    return await this.loadWorkflowFromFile(tab.input.uri);
                }
                if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.endsWith('.workflow.yaml')) {
                    return await this.loadWorkflowFromFile(tab.input.uri);
                }
            }
        }

        // Fallback: try visible text editors
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.fsPath.endsWith('.workflow.yaml')) {
                return await this.loadWorkflowFromFile(editor.document.uri);
            }
        }

        return false;
    }

    /**
     * Run the current workflow inside a Copilot Chat participant request.
     */
    async runCurrentWorkflow(
        executionContext: CopilotSubagentExecutionContext,
        chatContext?: ChatRequestContext
    ): Promise<ExecutionStatus | undefined> {
        if (!this._currentWorkflow || !this._currentFileUri) {
            vscode.window.showWarningMessage('No workflow loaded. Open a .workflow.yaml file first.');
            return undefined;
        }

        if (this._stateManager.getStatus() === ExecutionStatus.Running) {
            vscode.window.showWarningMessage('Workflow is already running.');
            return this._stateManager.getStatus();
        }

        const errors = validateWorkflow(this._currentWorkflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        if (fatalErrors.length > 0) {
            this.showValidationErrors(fatalErrors);
            return undefined;
        }

        this._outputChannel.clear();
        this.log(`▶ Starting workflow with genuine Copilot subagents: ${this._currentWorkflow.name}`);
        this.log(`   Nodes: ${this._currentWorkflow.nodes.length}, Edges: ${this._currentWorkflow.edges.length}`);
        this.log('');

        this._activeCopilotContext = executionContext;
        const chatCancellation = executionContext.cancellationToken.onCancellationRequested(() => {
            this._abortController?.abort();
            this._stateManager.complete(ExecutionStatus.Stopped);
            this.updateStatusBar(ExecutionStatus.Stopped);
        });

        try {
            await this.execute(this._currentWorkflow, chatContext);
            return this._stateManager.getStatus();
        } finally {
            chatCancellation.dispose();
            this._activeCopilotContext = null;
        }
    }

    hasCurrentWorkflow(): boolean {
        return this._currentWorkflow !== null && this._currentFileUri !== null;
    }

    getCurrentWorkflowName(): string | undefined {
        return this._currentWorkflow?.name;
    }

    /**
     * Execute a workflow
     */
    private async execute(workflow: Workflow, chatContext?: ChatRequestContext): Promise<void> {
        this._stateManager.initialize();
        this._abortController = new AbortController();
        this.updateStatusBar(ExecutionStatus.Running);

        // Store chat context in workflow state AFTER initialize() clears state
        if (chatContext) {
            if (chatContext.prompt) {
                this._stateManager.set('chatPrompt', chatContext.prompt);
            }
            if (chatContext.references && chatContext.references.length > 0) {
                const refUris = chatContext.references.map(r => {
                    if ('documentUri' in r) {
                        return (r.documentUri as vscode.Uri)?.toString() || (r.documentUri as string);
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
            this.log('✗ No Start node found in workflow.');
            vscode.window.showErrorMessage('No Start node found in workflow.');
            this._stateManager.complete(ExecutionStatus.Failed);
            this.updateStatusBar(ExecutionStatus.Failed);
            return;
        }

        try {
            // Initialize start node
            this.log(`✓ Start node: ${startNode.id}`);
            this._stateManager.createNodeRecord(startNode.id, NodeStatus.Completed, this.getNodeLabel(startNode));
            this._stateManager.setCurrentNode(startNode.id);
            this.notifyExecutionUpdate();

            // Get next nodes from start
            let currentNodeIds = this.getAllNextNodes(startNode.id, workflow);

            // Execute until no more nodes or stopped
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
                    this.log(`  ⠋ Running ${nodeId} (${label})...`);
                    const result = await this.executeNode(node, workflow);
                    this.notifyExecutionUpdate();

                    if (result.success) {
                        this.log(`  ✓ ${nodeId} completed`);
                        // Get next nodes, filtering by branch result if applicable
                        const children = this.getNextNodes(nodeId, node, workflow, result.branchResult);
                        nextNodeIds.push(...children);

                        // Collect nodes on untaken branches for skipping
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
                        this.log(`  ✗ ${nodeId} failed`);
                        hadFailure = true;
                    }
                }

                // Mark skipped nodes recursively
                for (const skipId of skippedNodeIds) {
                    this.markSkipped(skipId, workflow);
                }

                currentNodeIds = nextNodeIds;
            }

            if (!this.isAborted()) {
                if (hadFailure) {
                    this._stateManager.complete(ExecutionStatus.Failed);
                    this.updateStatusBar(ExecutionStatus.Failed);
                    this.log('');
                    this.log('✗ Workflow finished with errors.');
                    vscode.window.showWarningMessage('Workflow finished with errors.');
                } else {
                    this._stateManager.complete(ExecutionStatus.Completed);
                    this.updateStatusBar(ExecutionStatus.Completed);
                    this.log('');
                    this.log('✓ Workflow completed successfully!');
                    vscode.window.showInformationMessage('Workflow completed successfully.');
                }
            }
        } catch (error) {
            this._stateManager.complete(ExecutionStatus.Failed);
            this.updateStatusBar(ExecutionStatus.Failed);
            this.log(`\n✗ Workflow failed: ${error}`);
            vscode.window.showErrorMessage(`Workflow failed: ${error}`);
        }

        // Save to run history
        this.saveRunHistory();

        this._abortController = null;
        this.notifyExecutionUpdate();
    }

    /**
     * Save execution to run history
     */
    private saveRunHistory(): void {
        const execContext = this._stateManager.context;
        const record: RunRecord = {
            id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            timestamp: execContext.startTime || Date.now(),
            workflowUri: this._currentFileUri?.toString() || 'unknown',
            workflowName: this._currentWorkflow?.name || 'unknown',
            status: execContext.status,
            duration: execContext.endTime && execContext.startTime
                ? execContext.endTime - execContext.startTime : 0,
            state: { ...execContext.state },
            nodeRecords: Array.from(execContext.nodeRecords.entries())
        };
        this._runHistory.addRun(record);
    }

    /**
     * Get run history
     */
    getRunHistory(): RunHistoryManager {
        return this._runHistory;
    }

    /**
     * Execute a single node
     */
    private async executeNode(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        this._stateManager.updateNodeStatus(node.id, NodeStatus.Running);
        this._stateManager.startNode(node.id);

        try {
            switch (node.type) {
                case NodeType.Start:
                    // No execution needed
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return { success: true };

                case NodeType.End:
                    this.executeEndNode(node);
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return { success: true };

                case NodeType.Agent:
                    const agentOk = await this.executeAgentNode(node, workflow);
                    return { success: agentOk };

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

    /**
     * Execute an Agent node
     */
    private async executeAgentNode(node: Node, _workflow: Workflow): Promise<boolean> {
        const data = node.data as AgentNodeData;
        const record = this._stateManager.getNodeRecord(node.id);

        // Find the agent file
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            this.log(`     ✗ No workspace folder found`);
            this._stateManager.addError(node.id, 'No workspace folder found');
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            return false;
        }

        const agentPath = this.resolveAgentPath(data.agent, workspaceFolder);
        this.log(`     → Agent: ${data.agent} (${agentPath})`);
        if (data.model) {
            this.log(`     → Model: ${data.model}`);
        }

        const copilotContext = this._activeCopilotContext;
        if (!copilotContext) {
            const message = 'Agent nodes require execution from the @workflow Copilot Chat participant.';
            this._stateManager.addError(node.id, message);
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            this.log(`     ✗ ${message}`);
            return false;
        }

        // Handle retries. Every attempt remains a genuine Copilot subagent call.
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
                (msg: string) => this.log(`     ${msg}`),
                (msg: string) => this.updateAgentProgress(msg)
            );

            if (result.success) {
                // Clear progress indicator - terminate the progress line and restore status bar
                this._outputChannel.appendLine(''); // newline to terminate progress line
                this.updateStatusBar(ExecutionStatus.Running);

                // Log file modifications
                if (result.filesModified && result.filesModified.length > 0) {
                    this.log(`     → Files modified: ${result.filesModified.join(', ')}`);
                }

                // Log the agent output so the user can see it
                const outputPreview = result.output.length > 500
                    ? result.output.substring(0, 500) + '...\n     (output truncated, see Output panel for full response)'
                    : result.output;
                this.log(`     → Agent output:\n${outputPreview.split('\n').join('\n')}`);

                // ALWAYS store agent output in state so downstream agents can access it
                this._stateManager.set(`${node.id}_output`, result.output);
                this._stateManager.set(`${node.id}_success`, true);

                // Write state outputs if configured
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
            // Terminate the progress line before logging the error
            this._outputChannel.appendLine('');
            this.log(`     ✗ Agent failed (attempt ${attempt + 1}): ${lastError}`);
        }

        this._stateManager.endNode(node.id, NodeStatus.Failed);
        this._stateManager.addError(node.id, `All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        this.log(`     ✗ All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
        return false;
    }

    /**
     * Execute a Condition node
     * Returns a branch result so the runtime follows only the matching edge.
     */
    private async executeConditionNode(node: Node, workflow: Workflow): Promise<NodeExecutionResult> {
        const data = node.data as ConditionNodeData;
        const result = ConditionEvaluator.evaluate(data.expression, this._stateManager.state);

        this._stateManager.addLog(node.id, `Condition evaluated to: ${result}`);
        this._stateManager.set(`${node.id}_result`, result);

        // Update edge labels for visualization
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

    /**
     * Execute a Human Approval node
     * Returns a branch result: true for Approve, false for Reject.
     * The runtime routes to the matching edge (True/False or Approve/Reject).
     */
    private async executeHumanApprovalNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as HumanApprovalNodeData;
        this._stateManager.updateNodeStatus(node.id, NodeStatus.Paused);
        this.notifyExecutionUpdate();

        const result = await vscode.window.showWarningMessage(
            `Human Approval Required: ${data.message}`,
            { modal: true },
            'Approve',
            'Reject'
        );

        const approved = result === 'Approve';
        this._stateManager.set(`${node.id}_approved`, approved);
        this._stateManager.addLog(node.id, `Approval result: ${approved ? 'Approved' : 'Rejected'}`);

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return { success: true, branchResult: approved };
    }

    /**
     * Execute a Delay node
     */
    private async executeDelayNode(node: Node): Promise<NodeExecutionResult> {
        const data = node.data as DelayNodeData;
        this._stateManager.addLog(node.id, `Waiting ${data.duration} seconds...`);

        // Use interval-based wait so we can check for abort
        const start = Date.now();
        while (Date.now() - start < data.duration * 1000) {
            if (this.isAborted()) return { success: false };
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return { success: true };
    }

    /**
     * Execute an End node - generates a summary of the workflow execution.
     */
    private executeEndNode(node: Node): void {
        const data = node.data as EndNodeData;
        // Default to showing summary unless explicitly disabled
        if (data.summary === false) return;

        // Build summary immediately (endTime may not be set yet; we'll update later)
        const summary = this.buildExecutionSummary();
        this._stateManager.set('executionSummary', summary);
        this._stateManager.addLog(node.id, summary);

        // Log summary to output channel
        for (const line of summary.split('\n')) {
            this.log(line);
        }
    }

    /**
     * Build a formatted summary of the workflow execution.
     * Can be called before or after completion; uses current time if endTime not set.
     */
    private buildExecutionSummary(): string {
        const execContext = this._stateManager.context;
        const nodeRecords = execContext.nodeRecords;

        const lines: string[] = [];
        lines.push('');
        lines.push('═══ Workflow Execution Summary ═══');
        lines.push(`Workflow: ${this._currentWorkflow?.name || 'unknown'}`);

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

            // Include agent output if available
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

    /**
     * Get the execution summary (generated by the End node).
     * Returns undefined if no summary was generated.
     */
    getExecutionSummary(): string | undefined {
        return this._stateManager.get('executionSummary') as string | undefined;
    }

    /**
     * Format a duration in milliseconds to a human-readable string.
     */
    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }

    /**
     * Pause execution
     */
    pause(): void {
        if (this._stateManager.getStatus() === ExecutionStatus.Running) {
            this._stateManager.setStatus(ExecutionStatus.Paused);
            this.updateStatusBar(ExecutionStatus.Paused);
            vscode.window.showInformationMessage('Workflow paused.');
        }
    }

    /**
     * Resume execution
     */
    resume(): void {
        if (this._stateManager.getStatus() === ExecutionStatus.Paused) {
            this._stateManager.setStatus(ExecutionStatus.Running);
            this.updateStatusBar(ExecutionStatus.Running);
            vscode.window.showInformationMessage('Workflow resumed.');
        }
    }

    /**
     * Stop execution
     */
    stop(): void {
        this._abortController?.abort();
        this._stateManager.complete(ExecutionStatus.Stopped);
        this.updateStatusBar(ExecutionStatus.Stopped);
        vscode.window.showInformationMessage('Workflow stopped.');
    }

    /**
     * Get execution context for UI updates
     */
    getExecutionContext() {
        return this._stateManager.context;
    }

    /**
     * Get state manager (for testing)
     */
    getStateManager(): StateManager {
        return this._stateManager;
    }

    // ---- Private helpers ----

    /**
     * Get outgoing target node IDs, optionally filtered by branch result.
     * When `node` and `branchResult` are provided (for Condition/HumanApproval nodes),
     * only edges matching the True/False label are returned.
     */
    private getNextNodes(nodeId: string, node: Node, workflow: Workflow, branchResult?: boolean): string[] {
        const allEdges = workflow.edges.filter(e => e.source === nodeId);

        // For branching nodes, filter edges by the branch result
        if (branchResult !== undefined && (node.type === NodeType.Condition || node.type === NodeType.HumanApproval)) {
            return allEdges
                .filter(e => this.edgeMatchesBranch(e, branchResult))
                .map(e => e.target);
        }

        return allEdges.map(e => e.target);
    }

    /**
     * Get all outgoing target node IDs for a given node (no branch filtering).
     */
    private getAllNextNodes(nodeId: string, workflow: Workflow): string[] {
        return workflow.edges
            .filter(e => e.source === nodeId)
            .map(e => e.target);
    }

    /**
     * Check whether an edge represents the True/Approve branch.
     */
    private isTrueEdge(edge: { label?: string }): boolean {
        const label = edge.label?.toLowerCase();
        return label === 'true' || label === 'pass' || label === 'approve';
    }

    /**
     * Check whether an edge matches the given branch result.
     */
    private edgeMatchesBranch(edge: { label?: string }, branchResult: boolean): boolean {
        if (branchResult) {
            return this.isTrueEdge(edge);
        } else {
            // False branch: edge labeled False/Fail/Reject, or unlabeled (fallback)
            const label = edge.label?.toLowerCase();
            return label === 'false' || label === 'fail' || label === 'reject' || !label;
        }
    }

    /**
     * Mark a node and its descendants as Skipped (untaken branch).
     */
    private markSkipped(nodeId: string, workflow: Workflow): void {
        // Avoid re-marking already-processed nodes
        const existing = this._stateManager.getNodeRecord(nodeId);
        if (existing && (existing.status === NodeStatus.Skipped || existing.status === NodeStatus.Completed || existing.status === NodeStatus.Failed)) {
            return;
        }

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) return;

        this._stateManager.createNodeRecord(nodeId, NodeStatus.Skipped, this.getNodeLabel(node));
        this.log(`  ⊘ ${nodeId} skipped (untaken branch)`);
        this.notifyExecutionUpdate();

        // Recursively skip descendants
        const children = this.getAllNextNodes(nodeId, workflow);
        for (const childId of children) {
            this.markSkipped(childId, workflow);
        }
    }

    private getNodeLabel(node: Node): string {
        const d = node.data as any;
        return d.label || d.agent || d.message || node.id;
    }

    private resolveAgentPath(agentName: string, workspaceFolder: vscode.WorkspaceFolder): string {
        // Try .github/agents/ first
        const agentsDir = path.join(workspaceFolder.uri.fsPath, '.github', 'agents');
        const agentFile = path.join(agentsDir, `${agentName}.agent.md`);

        if (fs.existsSync(agentFile)) {
            return agentFile;
        }

        // Try as absolute path
        if (fs.existsSync(agentName)) {
            return agentName;
        }

        // Try relative to workspace
        const relativePath = path.join(workspaceFolder.uri.fsPath, agentName);
        if (fs.existsSync(relativePath)) {
            return relativePath;
        }

        return agentFile; // Return expected path even if not found (will fail gracefully)
    }

    private isAborted(): boolean {
        return this._abortController?.signal.aborted ?? false;
    }

    private log(message: string): void {
        this._outputChannel.appendLine(message);
    }

    private updateAgentProgress(message: string): void {
        this._statusBarItem.text = `$$(sync~spin) ${message}`;
        this._statusBarItem.show();
        this._outputChannel.append(`\r     ⠋ ${message.padEnd(80)}`);
        this._activeCopilotContext?.reportProgress?.(message);
    }

    private updateStatusBar(status: ExecutionStatus): void {
        const icons: Record<ExecutionStatus, string> = {
            [ExecutionStatus.Idle]: '$$(eye)',
            [ExecutionStatus.Running]: '$$(sync~spin)',
            [ExecutionStatus.Paused]: '$$(debug-pause)',
            [ExecutionStatus.Completed]: '$$(check)',
            [ExecutionStatus.Failed]: '$$(error)',
            [ExecutionStatus.Stopped]: '$$(stop)'
        };
        const labels: Record<ExecutionStatus, string> = {
            [ExecutionStatus.Idle]: 'Idle',
            [ExecutionStatus.Running]: 'Running',
            [ExecutionStatus.Paused]: 'Paused',
            [ExecutionStatus.Completed]: 'Completed',
            [ExecutionStatus.Failed]: 'Failed',
            [ExecutionStatus.Stopped]: 'Stopped'
        };
        this._statusBarItem.text = `${icons[status]} Workflow: ${labels[status]}`;
        this._statusBarItem.show();
    }

    private notifyExecutionUpdate(): void {
        // Notify webviews about execution state changes
        vscode.commands.executeCommand('setContext', 'workflow.running',
            this._stateManager.getStatus() === ExecutionStatus.Running);
        // Build node status map for webview
        const nodeStatuses: Record<string, any> = {};
        for (const [id, record] of this._stateManager.context.nodeRecords) {
            nodeStatuses[id] = {
                status: record.status, // Already lowercase string (e.g., 'running')
                startTime: record.startTime,
                endTime: record.endTime,
                duration: record.duration
            };
        }
        this._onDidChangeExecutionState.fire({
            overall: this._stateManager.getStatus(), // Already lowercase string (e.g., 'running')
            currentNodeId: this._stateManager.context.currentNodeId,
            nodeStatuses
        });
    }

    private showValidationErrors(errors: any[]): void {
        for (const error of errors) {
            vscode.window.showErrorMessage(`Validation: ${error.message}`);
        }
    }

    /**
     * Validate a workflow and return errors
     */
    validate(workflow: Workflow): any[] {
        return validateWorkflow(workflow);
    }

    private extractValue(output: string, field: string): unknown {
        // Try to parse JSON output first
        try {
            const parsed = JSON.parse(output);
            return parsed[field];
        } catch {
            // Return raw output for simple cases
            return output;
        }
    }

    dispose(): void {
        this.stop();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
