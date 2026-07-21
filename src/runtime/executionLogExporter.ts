import { NodeExecutionRecord, ExecutionStatus } from '../models/workflow';

/**
 * Format the current execution's node records as a readable text log.
 *
 * Pure function — no VS Code dependencies — so it can be unit-tested in isolation.
 */
export function exportExecutionLogs(
    records: Map<string, NodeExecutionRecord>,
    workflowName: string,
    status: ExecutionStatus,
    startTime?: number,
    endTime?: number
): string {
    const lines: string[] = [];

    lines.push(`Workflow Execution Log`);
    lines.push(`Workflow: ${workflowName}`);
    lines.push(`Status: ${status}`);
    if (startTime) {
        lines.push(`Started: ${new Date(startTime).toISOString()}`);
    }
    if (endTime) {
        lines.push(`Finished: ${new Date(endTime).toISOString()}`);
    }
    if (startTime && endTime) {
        lines.push(`Duration: ${endTime - startTime}ms`);
    }
    lines.push('='.repeat(50));

    if (records.size === 0) {
        lines.push('\nNo node execution records.');
        return lines.join('\n');
    }

    for (const [nodeId, record] of records) {
        lines.push('');
        lines.push(`Node: ${nodeId} (${record.nodeName || 'unknown'})`);
        lines.push(`  Status: ${record.status}`);
        if (record.startTime) {
            lines.push(`  Started: ${new Date(record.startTime).toISOString()}`);
        }
        if (record.endTime) {
            lines.push(`  Finished: ${new Date(record.endTime).toISOString()}`);
        }
        if (record.duration !== undefined) {
            lines.push(`  Duration: ${record.duration}ms`);
        }
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
        if (record.contextIn) {
            lines.push(`  Context In: ${JSON.stringify(record.contextIn)}`);
        }
        if (record.contextOut) {
            lines.push(`  Context Out: ${JSON.stringify(record.contextOut)}`);
        }
    }

    return lines.join('\n');
}
