/**
 * Tests for the export execution logs feature.
 *
 * Covers:
 * - exportExecutionLogs() formats logs correctly
 * - Export includes node execution records with status, timing, logs, errors
 * - Export handles empty execution context gracefully
 */

import {
    NodeStatus, ExecutionStatus,
    NodeExecutionRecord
} from '../src/models/workflow';
import { exportExecutionLogs } from '../src/runtime/executionLogExporter';

// ---- exportExecutionLogs utility tests ----

describe('exportExecutionLogs utility', () => {

    it('should produce a formatted log string with node records', () => {
        const records = new Map<string, NodeExecutionRecord>();
        records.set('start', {
            nodeId: 'start',
            nodeName: 'Start',
            status: NodeStatus.Completed,
            startTime: 1000,
            endTime: 1010,
            duration: 10,
            logs: ['started workflow'],
            errors: [],
        });
        records.set('agent1', {
            nodeId: 'agent1',
            nodeName: 'Code Review Agent',
            status: NodeStatus.Completed,
            startTime: 1010,
            endTime: 1500,
            duration: 490,
            logs: ['invoking agent', 'agent completed'],
            errors: [],
        });

        const output = exportExecutionLogs(records, 'test-workflow', ExecutionStatus.Completed, 1000, 1500);

        expect(output).toContain('test-workflow');
        expect(output).toContain('completed');
        expect(output).toContain('start');
        expect(output).toContain('Start');
        expect(output).toContain('agent1');
        expect(output).toContain('Code Review Agent');
        expect(output).toContain('started workflow');
        expect(output).toContain('invoking agent');
        expect(output).toContain('agent completed');
    });

    it('should include error messages in the export', () => {
        const records = new Map<string, NodeExecutionRecord>();
        records.set('agent1', {
            nodeId: 'agent1',
            nodeName: 'Failing Agent',
            status: NodeStatus.Failed,
            startTime: 1000,
            endTime: 1200,
            duration: 200,
            logs: ['invoking agent'],
            errors: ['timeout exceeded', 'connection refused'],
        });

        const output = exportExecutionLogs(records, 'fail-workflow', ExecutionStatus.Failed, 1000, 1200);

        expect(output).toContain('Failing Agent');
        expect(output).toContain('failed');
        expect(output).toContain('timeout exceeded');
        expect(output).toContain('connection refused');
    });

    it('should handle empty node records gracefully', () => {
        const records = new Map<string, NodeExecutionRecord>();

        const output = exportExecutionLogs(records, 'empty-workflow', ExecutionStatus.Idle);

        expect(output).toContain('empty-workflow');
        expect(output).toContain('No node execution records');
    });

    it('should include timestamps in the output', () => {
        const records = new Map<string, NodeExecutionRecord>();
        records.set('node1', {
            nodeId: 'node1',
            nodeName: 'Test Node',
            status: NodeStatus.Completed,
            startTime: 1700000000000,
            endTime: 1700000001000,
            duration: 1000,
            logs: [],
            errors: [],
        });

        const output = exportExecutionLogs(records, 'timing-workflow', ExecutionStatus.Completed, 1700000000000, 1700000001000);

        // Should contain ISO date string for the timestamp
        expect(output).toContain('2023-11-14');
    });

    it('should include duration information', () => {
        const records = new Map<string, NodeExecutionRecord>();
        records.set('node1', {
            nodeId: 'node1',
            nodeName: 'Slow Node',
            status: NodeStatus.Completed,
            startTime: 1000,
            endTime: 3000,
            duration: 2000,
            logs: [],
            errors: [],
        });

        const output = exportExecutionLogs(records, 'duration-workflow', ExecutionStatus.Completed, 1000, 3000);

        expect(output).toContain('2000');
    });
});
