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
