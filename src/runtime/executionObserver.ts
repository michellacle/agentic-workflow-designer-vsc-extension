import * as vscode from 'vscode';
import { ExecutionStatus } from '../models/workflow';

/**
 * Observer for workflow execution events.
 * This is the seam between the execution engine and the UI layer.
 * Two adapters: VSCodeExecutionObserver (prod) and InMemoryExecutionObserver (tests).
 */
export interface ExecutionObserver {
    onStatusChange(status: ExecutionStatus): void;
    onLog(message: string): void;
    onProgress(message: string): void;
    onNotification(type: 'info' | 'warning' | 'error', message: string): void;
    requestApproval(message: string): Promise<boolean>;
    clearLog(): void;
}

/**
 * VS Code adapter for ExecutionObserver.
 * Routes execution events to status bar, output channel, and toast notifications.
 */
export class VSCodeExecutionObserver implements ExecutionObserver {
    private _statusBarItem: vscode.StatusBarItem;

    constructor(private readonly outputChannel: vscode.OutputChannel) {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.text = '$$(eye) Workflow: Idle';
        this._statusBarItem.tooltip = 'Workflow execution status';
    }

    dispose(): void {
        this._statusBarItem.dispose();
    }

    onStatusChange(status: ExecutionStatus): void {
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

    onLog(message: string): void {
        this.outputChannel.appendLine(message);
    }

    onProgress(message: string): void {
        this._statusBarItem.text = `$$(sync~spin) ${message}`;
        this._statusBarItem.show();
        this.outputChannel.append(`\r     ⠋ ${message.padEnd(80)}`);
    }

    onNotification(type: 'info' | 'warning' | 'error', message: string): void {
        switch (type) {
            case 'info': vscode.window.showInformationMessage(message); break;
            case 'warning': vscode.window.showWarningMessage(message); break;
            case 'error': vscode.window.showErrorMessage(message); break;
        }
    }

    async requestApproval(message: string): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(
            `Human Approval Required: ${message}`,
            { modal: true },
            'Approve',
            'Reject'
        );
        return result === 'Approve';
    }

    clearLog(): void {
        this.outputChannel.clear();
    }
}

/**
 * In-memory adapter for ExecutionObserver.
 * Used in tests to capture execution events without VS Code.
 */
export class InMemoryExecutionObserver implements ExecutionObserver {
    logs: string[] = [];
    notifications: { type: string; message: string }[] = [];
    statusChanges: ExecutionStatus[] = [];
    progressMessages: string[] = [];
    private _approvalResult: boolean | undefined;

    onStatusChange(status: ExecutionStatus): void {
        this.statusChanges.push(status);
    }

    onLog(message: string): void {
        this.logs.push(message);
    }

    onProgress(message: string): void {
        this.progressMessages.push(message);
    }

    onNotification(type: 'info' | 'warning' | 'error', message: string): void {
        this.notifications.push({ type, message });
    }

    setApprovalResult(result: boolean): void {
        this._approvalResult = result;
    }

    async requestApproval(_message: string): Promise<boolean> {
        return this._approvalResult ?? true;
    }

    clearLog(): void {
        // no-op
    }

    clear(): void {
        this.logs = [];
        this.notifications = [];
        this.statusChanges = [];
        this.progressMessages = [];
    }
}
