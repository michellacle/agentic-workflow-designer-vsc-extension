import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    Workflow, Node, NodeType,
    ExecutionStatus, NodeStatus,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData
} from '../models/workflow';
import { StateManager } from './stateManager';
import { ConditionEvaluator } from './conditionEvaluator';
import { AgentInvoker, CopilotSubagentExecutionContext } from './agentInvoker';
import { RunHistoryManager, RunRecord } from './runHistory';
import { validateWorkflow } from '../utils/workflowValidator';

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
            let currentNodeIds = this.getNextNodes(startNode.id, workflow);

            // Execute until no more nodes or stopped
            let hadFailure = false;
            while (currentNodeIds.length > 0 && !this.isAborted()) {
                const nextNodeIds: string[] = [];

                for (const nodeId of currentNodeIds) {
                    if (this.isAborted()) break;

                    const node = workflow.nodes.find(n => n.id === nodeId);
                    if (!node) continue;

                    this._stateManager.setCurrentNode(nodeId);
                    this._stateManager.createNodeRecord(nodeId, NodeStatus.Waiting, this.getNodeLabel(node));
                    this.notifyExecutionUpdate();

                    const label = this.getNodeLabel(node);
                    this.log(`  ⠋ Running ${nodeId} (${label})...`);
                    const success = await this.executeNode(node, workflow);
                    this.notifyExecutionUpdate();

                    if (success) {
                        this.log(`  ✓ ${nodeId} completed`);
                        // Get next nodes
                        const children = this.getNextNodes(nodeId, workflow);
                        nextNodeIds.push(...children);
                    } else {
                        this.log(`  ✗ ${nodeId} failed`);
                        hadFailure = true;
                    }
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
    private async executeNode(node: Node, workflow: Workflow): Promise<boolean> {
        this._stateManager.updateNodeStatus(node.id, NodeStatus.Running);
        this._stateManager.startNode(node.id);

        try {
            switch (node.type) {
                case NodeType.Start:
                case NodeType.End:
                    // No execution needed
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return true;

                case NodeType.Agent:
                    return this.executeAgentNode(node, workflow);

                case NodeType.Condition:
                    return this.executeConditionNode(node, workflow);

                case NodeType.HumanApproval:
                    return this.executeHumanApprovalNode(node);

                case NodeType.Delay:
                    return this.executeDelayNode(node);

                default:
                    this._stateManager.endNode(node.id, NodeStatus.Completed);
                    return true;
            }
        } catch (error) {
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            this._stateManager.addError(node.id, String(error));
            return false;
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
     */
    private async executeConditionNode(node: Node, workflow: Workflow): Promise<boolean> {
        const data = node.data as ConditionNodeData;
        const result = ConditionEvaluator.evaluate(data.expression, this._stateManager.state);

        this._stateManager.addLog(node.id, `Condition evaluated to: ${result}`);
        this._stateManager.set(`${node.id}_result`, result);

        // Update edge labels for visualization
        const outgoingEdges = workflow.edges.filter(e => e.source === node.id);
        for (const edge of outgoingEdges) {
            const isTruePath = edge.label?.toLowerCase() === 'true' || edge.label?.toLowerCase() === 'pass';
            if ((result && isTruePath) || (!result && !isTruePath)) {
                this._stateManager.addLog(node.id, `Taking branch: ${edge.label || (result ? 'True' : 'False')}`);
            }
        }

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return true;
    }

    /**
     * Execute a Human Approval node
     */
    private async executeHumanApprovalNode(node: Node): Promise<boolean> {
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

        if (approved) {
            this._stateManager.endNode(node.id, NodeStatus.Completed);
            return true;
        } else {
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            return false;
        }
    }

    /**
     * Execute a Delay node
     */
    private async executeDelayNode(node: Node): Promise<boolean> {
        const data = node.data as DelayNodeData;
        this._stateManager.addLog(node.id, `Waiting ${data.duration} seconds...`);

        // Use interval-based wait so we can check for abort
        const start = Date.now();
        while (Date.now() - start < data.duration * 1000) {
            if (this.isAborted()) return false;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this._stateManager.endNode(node.id, NodeStatus.Completed);
        return true;
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

    private getNextNodes(nodeId: string, workflow: Workflow): string[] {
        return workflow.edges
            .filter(e => e.source === nodeId)
            .map(e => e.target);
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
