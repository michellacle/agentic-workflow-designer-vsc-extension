import * as vscode from 'vscode';
import {
    Workflow,
    ExecutionStatus,
} from '../models/workflow';
import { WorkflowExecutor, ChatRequestContext, ExecutionStateChangeEvent } from './workflowExecutor';
import { CopilotSubagentExecutionContext } from './executionContext';
import { AgentInvoker } from './agentInvoker';
import { RunHistoryManager, RunRecord } from './runHistory';
import { VSCodeExecutionObserver } from './executionObserver';
import { ValidationError } from '../utils/workflowValidator';

// Re-export from WorkflowExecutor for backward compatibility
export { NodeExecutionResult } from './workflowExecutor';

/**
 * Thin I/O adapter over WorkflowExecutor.
 *
 * Responsibilities:
 * - Workflow file loading / discovery (I/O concern)
 * - Run history persistence (storage concern)
 * - VS Code observer creation (UI adapter)
 * - Lifecycle management (Disposable)
 *
 * Execution logic delegates to WorkflowExecutor.
 */
export class WorkflowRuntime implements vscode.Disposable {
    private _executor: WorkflowExecutor;
    private _runHistory: RunHistoryManager;
    private _observer: VSCodeExecutionObserver;
    private _disposables: vscode.Disposable[] = [];
    private _currentWorkflow: Workflow | null = null;
    private _currentFileUri: vscode.Uri | null = null;

    private readonly _onDidChangeExecutionState = new vscode.EventEmitter<ExecutionStateChangeEvent>();
    public readonly onDidChangeExecutionState = this._onDidChangeExecutionState.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._observer = new VSCodeExecutionObserver(
            vscode.window.createOutputChannel('Workflow Executor')
        );
        const agentInvoker = new AgentInvoker();
        this._executor = new WorkflowExecutor(this._observer, agentInvoker);
        this._runHistory = new RunHistoryManager(context);
        this._disposables.push(this._observer);

        // Forward executor events to our own event emitter
        const unsubscribe = this._executor.onDidChangeExecutionState((state) => {
            // Set VS Code command context for toolbar button states
            vscode.commands.executeCommand('setContext', 'workflow.running',
                state.overall === ExecutionStatus.Running);
            this._onDidChangeExecutionState.fire(state);
        });
        this._disposables.push({ dispose: unsubscribe });
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
            this._observer.onLog(`Failed to load workflow from ${uri.fsPath}: ${error}`);
            return false;
        }
    }

    /**
     * Try to discover and load a workflow file from the active editor or chat references.
     */
    async tryLoadWorkflowFromContext(chatContext?: ChatRequestContext): Promise<boolean> {
        if (this._currentWorkflow && this._currentFileUri) {
            return true;
        }

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

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.workflow.yaml')) {
            return await this.loadWorkflowFromFile(activeEditor.document.uri);
        }

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

        if (this._executor.getExecutionContext().status === ExecutionStatus.Running) {
            vscode.window.showWarningMessage('Workflow is already running.');
            return this._executor.getExecutionContext().status;
        }

        const errors = this._executor.validate(this._currentWorkflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        if (fatalErrors.length > 0) {
            for (const error of fatalErrors) {
                vscode.window.showErrorMessage(`Validation: ${error.message}`);
            }
            return undefined;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const status = await this._executor.run({
            workflow: this._currentWorkflow,
            chatContext,
            executionContext,
            workspaceRoot,
        });

        // Save to run history after execution completes
        this.saveRunHistory();

        return status;
    }

    hasCurrentWorkflow(): boolean {
        return this._currentWorkflow !== null && this._currentFileUri !== null;
    }

    getCurrentWorkflowName(): string | undefined {
        return this._currentWorkflow?.name;
    }

    /**
     * Save execution to run history
     */
    private saveRunHistory(): void {
        const execContext = this._executor.getExecutionContext();
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
     * Get the execution summary (generated by the End node).
     */
    getExecutionSummary(): string | undefined {
        return this._executor.getExecutionSummary();
    }

    /**
     * Pause execution
     */
    pause(): void {
        this._executor.pause();
    }

    /**
     * Resume execution. Delegates to executor, then shows VS Code toast.
     */
    resume(): void {
        const resumed = this._executor.resume();
        if (resumed) {
            vscode.window.showInformationMessage('Workflow resumed.');
        }
    }

    /**
     * Stop execution
     */
    stop(): void {
        this._executor.stop();
    }

    /**
     * Get execution context for UI updates
     */
    getExecutionContext() {
        return this._executor.getExecutionContext();
    }

    /**
     * Validate a workflow and return errors.
     */
    validate(workflow: Workflow): ValidationError[] {
        return this._executor.validate(workflow);
    }

    /**
     * Export the current execution's logs as a formatted text string.
     */
    exportCurrentExecutionLogs(): string {
        return this._executor.exportLogs(this._currentWorkflow?.name || 'unknown');
    }

    dispose(): void {
        this._executor.stop();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
