import * as fs from 'fs';
import * as path from 'path';
import {
    NodeExecutionRecord, ExecutionStatus, WorkflowState
} from '../models/workflow';
import { exportExecutionLogs } from './executionLogExporter';

/**
 * Reference metadata returned after writing a log file.
 */
export interface LogReference {
    /** Unique identifier for this log entry (matches the runId in the filename). */
    id: string;
    /** Absolute file system path to the log file. */
    path: string;
}

/**
 * Data required to write a persistent execution log.
 */
export interface ExecutionLogData {
    workflowName: string;
    status: ExecutionStatus;
    state: WorkflowState;
    nodeRecords: Map<string, NodeExecutionRecord>;
    startTime?: number;
    endTime?: number;
}

/**
 * Default maximum number of log files to retain in .workflow/logs/.
 */
const DEFAULT_MAX_LOGS = 100;

/**
 * Persistent execution log writer.
 *
 * Writes a log file to `.workflow/logs/` inside the workspace root for every
 * workflow run that ends in Completed, Failed, or Stopped. Enforces a retention
 * policy (default 100 files) by deleting the oldest logs on overflow.
 *
 * Pure file-system module — no VS Code dependencies — so it can be unit-tested
 * in isolation and injected into WorkflowRuntime.
 */
export class ExecutionLogWriter {
    private readonly logDir: string;

    /**
     * @param workspaceRoot  Root path of the workspace (e.g., from `vscode.workspace.workspaceFolders`).
     * @param maxLogs        Maximum number of log files to retain. Defaults to 100.
     */
    constructor(private readonly workspaceRoot: string, private readonly maxLogs: number = DEFAULT_MAX_LOGS) {
        this.logDir = path.join(workspaceRoot, '.workflow', 'logs');
    }

    /**
     * Returns `true` if a log file should be written for the given execution status.
     * Logs are persisted for terminal statuses: Completed, Failed, Stopped.
     */
    static shouldWriteLog(status: ExecutionStatus): boolean {
        return status === ExecutionStatus.Completed ||
            status === ExecutionStatus.Failed ||
            status === ExecutionStatus.Stopped;
    }

    /**
     * Write a persistent execution log file and enforce retention.
     *
     * @returns LogReference with the unique id and absolute file path.
     */
    async writeLog(data: ExecutionLogData): Promise<LogReference> {
        // Ensure the log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        const runId = this.generateRunId();
        const timestamp = this.getUtcCompactTimestamp();
        const safeName = this.sanitizeFileName(data.workflowName);
        const statusLabel = this.statusToLabel(data.status);

        const fileName = `${timestamp}_${safeName}_${statusLabel}_${runId}.log`;
        const filePath = path.join(this.logDir, fileName);

        // Build log content using the existing exporter, then append workflow state
        let content = exportExecutionLogs(
            data.nodeRecords,
            data.workflowName,
            data.status,
            data.startTime,
            data.endTime
        );

        // Append full workflow state to the log
        content += '\n\n';
        content += 'Workflow State\n';
        content += '-'.repeat(50) + '\n';
        if (Object.keys(data.state).length === 0) {
            content += '(empty)\n';
        } else {
            for (const [key, value] of Object.entries(data.state)) {
                const formatted = typeof value === 'string' ? value : JSON.stringify(value);
                content += `${key}: ${formatted}\n`;
            }
        }

        // Write the file
        fs.writeFileSync(filePath, content, 'utf-8');

        // Enforce retention policy
        this.enforceRetention();

        return {
            id: runId,
            path: filePath,
        };
    }

    /**
     * Enforce the retention policy by deleting the oldest log files
     * when the count exceeds the maximum.
     */
    private enforceRetention(): void {
        if (!fs.existsSync(this.logDir)) {
            return;
        }

        const files = fs.readdirSync(this.logDir)
            .filter(f => f.endsWith('.log'))
            .map(f => ({
                name: f,
                path: path.join(this.logDir, f),
                mtime: fs.statSync(path.join(this.logDir, f)).mtimeMs,
            }))
            .sort((a, b) => a.mtime - b.mtime); // oldest first

        while (files.length > this.maxLogs) {
            const oldest = files.shift();
            if (oldest) {
                try {
                    fs.unlinkSync(oldest.path);
                } catch {
                    // Ignore deletion errors (file may have been removed externally)
                }
            }
        }
    }

    /**
     * Generate a unique run identifier.
     */
    private generateRunId(): string {
        return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Get the current UTC time as a compact timestamp (YYYYMMDD).
     */
    private getUtcCompactTimestamp(): string {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Convert an ExecutionStatus enum value to a safe filename label.
     */
    private statusToLabel(status: ExecutionStatus): string {
        const labels: Record<ExecutionStatus, string> = {
            [ExecutionStatus.Idle]: 'idle',
            [ExecutionStatus.Running]: 'running',
            [ExecutionStatus.Paused]: 'paused',
            [ExecutionStatus.Completed]: 'completed',
            [ExecutionStatus.Failed]: 'failed',
            [ExecutionStatus.Stopped]: 'stopped',
        };
        return labels[status];
    }

    /**
     * Sanitize a workflow name for use in a filename.
     * Replaces characters that are unsafe in filenames.
     */
    private sanitizeFileName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // Remove unsafe characters
            .replace(/\s+/g, '_')                     // Replace whitespace with underscores
            .substring(0, 100);                       // Limit length
    }
}
