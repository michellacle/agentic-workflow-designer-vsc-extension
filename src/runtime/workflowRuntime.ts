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
import { AgentInvoker } from './agentInvoker';
import { validateWorkflow } from '../utils/workflowValidator';

/**
 * Main workflow execution engine
 */
export class WorkflowRuntime implements vscode.Disposable {
    private _stateManager: StateManager;
    private _agentInvoker: AgentInvoker;
    private _disposables: vscode.Disposable[] = [];
    private _currentWorkflow: Workflow | null = null;
    private _currentFileUri: vscode.Uri | null = null;
    private _abortController: AbortController | null = null;
    private _statusBarItem: vscode.StatusBarItem;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._stateManager = new StateManager();
        this._agentInvoker = new AgentInvoker(context);
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.text = '$$(eye) Workflow: Idle';
        this._statusBarItem.tooltip = 'Workflow execution status';
        this._disposables.push(this._statusBarItem);
    }

    /**
     * Set the current workflow being edited
     */
    setCurrentWorkflow(workflow: Workflow, uri: vscode.Uri): void {
        this._currentWorkflow = workflow;
        this._currentFileUri = uri;
    }

    /**
     * Run the current workflow
     */
    async runCurrentWorkflow(): Promise<void> {
        if (!this._currentWorkflow || !this._currentFileUri) {
            vscode.window.showWarningMessage('No workflow loaded. Open a .workflow.yaml file first.');
            return;
        }

        if (this._stateManager.getStatus() === ExecutionStatus.Running) {
            vscode.window.showWarningMessage('Workflow is already running.');
            return;
        }

        // Validate before running
        const errors = validateWorkflow(this._currentWorkflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        if (fatalErrors.length > 0) {
            this.showValidationErrors(fatalErrors);
            return;
        }

        // For Phase 2 (sequential), warn about cycles
        // For Phase 4+, cycles are allowed as loops

        await this.execute(this._currentWorkflow);
    }

    /**
     * Execute a workflow
     */
    private async execute(workflow: Workflow): Promise<void> {
        this._stateManager.initialize();
        this._abortController = new AbortController();
        this.updateStatusBar(ExecutionStatus.Running);

        const startNode = workflow.nodes.find(n => n.type === NodeType.Start);
        if (!startNode) {
            vscode.window.showErrorMessage('No Start node found in workflow.');
            this._stateManager.complete(ExecutionStatus.Failed);
            this.updateStatusBar(ExecutionStatus.Failed);
            return;
        }

        try {
            // Initialize start node
            this._stateManager.createNodeRecord(startNode.id, NodeStatus.Completed, this.getNodeLabel(startNode));
            this._stateManager.setCurrentNode(startNode.id);
            this.notifyExecutionUpdate();

            // Get next nodes from start
            let currentNodeIds = this.getNextNodes(startNode.id, workflow);

            // Execute until no more nodes or stopped
            while (currentNodeIds.length > 0 && !this.isAborted()) {
                const nextNodeIds: string[] = [];

                for (const nodeId of currentNodeIds) {
                    if (this.isAborted()) break;

                    const node = workflow.nodes.find(n => n.id === nodeId);
                    if (!node) continue;

                    this._stateManager.setCurrentNode(nodeId);
                    this._stateManager.createNodeRecord(nodeId, NodeStatus.Waiting, this.getNodeLabel(node));
                    this.notifyExecutionUpdate();

                    const success = await this.executeNode(node, workflow);
                    this.notifyExecutionUpdate();

                    if (success) {
                        // Get next nodes
                        const children = this.getNextNodes(nodeId, workflow);
                        nextNodeIds.push(...children);
                    }
                }

                currentNodeIds = nextNodeIds;
            }

            if (!this.isAborted()) {
                this._stateManager.complete(ExecutionStatus.Completed);
                this.updateStatusBar(ExecutionStatus.Completed);
                vscode.window.showInformationMessage('Workflow completed successfully.');
            }
        } catch (error) {
            this._stateManager.complete(ExecutionStatus.Failed);
            this.updateStatusBar(ExecutionStatus.Failed);
            vscode.window.showErrorMessage(`Workflow failed: ${error}`);
        }

        this._abortController = null;
        this.notifyExecutionUpdate();
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
            this._stateManager.addError(node.id, 'No workspace folder found');
            this._stateManager.endNode(node.id, NodeStatus.Failed);
            return false;
        }

        const agentPath = this.resolveAgentPath(data.agent, workspaceFolder);

        // Handle retries
        const maxRetries = data.retries || 0;
        let lastError = '';

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (this.isAborted()) return false;

            const result = await this._agentInvoker.invokeAgent(
                agentPath,
                data.prompt || '',
                { ...this._stateManager.state },
                data.timeout || 120,
                record
            );

            if (result.success) {
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
        }

        this._stateManager.endNode(node.id, NodeStatus.Failed);
        this._stateManager.addError(node.id, `All ${maxRetries + 1} attempts failed. Last error: ${lastError}`);
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
    }

    private showValidationErrors(errors: any[]): void {
        for (const error of errors) {
            vscode.window.showErrorMessage(`Validation: ${error.message}`);
        }
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
