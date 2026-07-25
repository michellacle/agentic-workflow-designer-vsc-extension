import * as vscode from 'vscode';
import { ExecutionStatus, NodeExecutionRecord } from '../models/workflow';

/**
 * Stores and manages workflow execution history
 */
export class RunHistoryManager {
    private static MAX_HISTORY = 50;
    private _history: RunRecord[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.load();
    }

    /**
     * Add a completed execution to history
     */
    addRun(record: RunRecord): void {
        this._history.unshift(record);
        if (this._history.length > RunHistoryManager.MAX_HISTORY) {
            this._history = this._history.slice(0, RunHistoryManager.MAX_HISTORY);
        }
        this.save();
    }

    /**
     * Get all history records
     */
    getHistory(): RunRecord[] {
        return this._history;
    }

    /**
     * Get the most recent run
     */
    getLatestRun(): RunRecord | undefined {
        return this._history[0];
    }

    /**
     * Get runs for a specific workflow file
     */
    getRunsForWorkflow(uri: string): RunRecord[] {
        return this._history.filter(r => r.workflowUri === uri);
    }

    /**
     * Clear all history
     */
    clear(): void {
        this._history = [];
        this.save();
    }

    /**
     * Export history as JSON
     */
    export(): string {
        return JSON.stringify(this._history, null, 2);
    }

    /**
     * Export execution logs for a specific run
     */
    exportRunLogs(runIndex: number): string {
        const run = this._history[runIndex];
        if (!run) {return '';}

        const lines: string[] = [];
        lines.push(`Workflow Run #${runIndex + 1}`);
        lines.push(`Date: ${new Date(run.timestamp).toISOString()}`);
        lines.push(`Status: ${run.status}`);
        lines.push(`Duration: ${run.duration}ms`);
        lines.push(`Workflow: ${run.workflowUri}`);
        lines.push('---');

        for (const [nodeId, record] of run.nodeRecords) {
            lines.push(`\nNode: ${nodeId} (${record.nodeName || 'unknown'})`);
            lines.push(`  Status: ${record.status}`);
            lines.push(`  Duration: ${record.duration || 'N/A'}ms`);
            if (record.logs?.length) {
                for (const log of record.logs) {
                    lines.push(`  [LOG] ${log}`);
                }
            }
            if (record.errors?.length) {
                for (const err of record.errors) {
                    lines.push(`  [ERR] ${err}`);
                }
            }
        }

        return lines.join('\n');
    }

    private save(): void {
        const globalState = this.context.globalState;
        globalState.update('workflowRunHistory', this._history);
    }

    private load(): void {
        const globalState = this.context.globalState;
        const data = globalState.get<RunRecord[]>('workflowRunHistory', []);
        this._history = data || [];
    }
}

/**
 * Record of a single workflow execution
 */
export interface RunRecord {
    id: string;
    timestamp: number;
    workflowUri: string;
    workflowName: string;
    status: ExecutionStatus;
    duration: number;
    state: Record<string, unknown>;
    nodeRecords: [string, NodeExecutionRecord][]; // Tuple array for JSON serialization
}
