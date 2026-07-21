/**
 * Tests for the execution log writer feature (Phase 2.6).
 *
 * Covers:
 * - Persists a log file to .workflow/logs/ on Completed, Failed, and Stopped statuses
 * - Skips log persistence for Idle and Running statuses
 * - Filename schema: {timestamp}_{workflowName}_{status}_{runId}.log
 * - Log content includes full execution context (state, node records, prompts, outputs, errors)
 * - Retention: keeps only the latest 100 logs, deletes oldest on overflow
 * - Returns log reference metadata (id + absolute path) after writing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    NodeStatus, ExecutionStatus,
    NodeExecutionRecord
} from '../src/models/workflow';
import { ExecutionLogWriter, LogReference } from '../src/runtime/executionLogWriter';

// Helper to create a temporary workspace root for testing
function createTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-log-test-'));
}

function cleanupWorkspace(workspaceRoot: string): void {
    try {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    } catch {
        // ignore cleanup errors
    }
}

// ---- ExecutionLogWriter tests ----

describe('ExecutionLogWriter', () => {

    let workspaceRoot: string;

    beforeEach(() => {
        workspaceRoot = createTempWorkspace();
    });

    afterEach(() => {
        cleanupWorkspace(workspaceRoot);
    });

    describe('writeLog', () => {

        it('should persist a log file to .workflow/logs/ on Completed status', async () => {
            const records = createSampleRecords();
            const writer = new ExecutionLogWriter(workspaceRoot);

            const ref = await writer.writeLog({
                workflowName: 'test-workflow',
                status: ExecutionStatus.Completed,
                state: { key: 'value' },
                nodeRecords: records,
                startTime: Date.now() - 5000,
                endTime: Date.now(),
            });

            expect(ref).toBeDefined();
            expect(ref.id).toBeDefined();
            expect(ref.path).toBeDefined();
            expect(ref.path).toContain('.workflow/logs/');
            expect(ref.path).toContain('.log');

            // Verify file exists on disk
            expect(fs.existsSync(ref.path)).toBe(true);

            // Verify filename schema: {timestamp}_{workflowName}_{status}_{runId}.log
            const basename = path.basename(ref.path, '.log');
            const parts = basename.split('_');
            expect(parts.length).toBeGreaterThanOrEqual(4);
            // First part should be a UTC compact timestamp (digits)
            expect(parts[0]).toMatch(/^\d{8}$/);
        });

        it('should persist a log file on Failed status', async () => {
            const records = createSampleRecords();
            records.set('agent1', {
                nodeId: 'agent1',
                nodeName: 'Failing Agent',
                status: NodeStatus.Failed,
                startTime: Date.now() - 3000,
                endTime: Date.now(),
                duration: 3000,
                logs: ['invoking agent'],
                errors: ['timeout exceeded'],
            });
            const writer = new ExecutionLogWriter(workspaceRoot);

            const ref = await writer.writeLog({
                workflowName: 'fail-workflow',
                status: ExecutionStatus.Failed,
                state: {},
                nodeRecords: records,
                startTime: Date.now() - 5000,
                endTime: Date.now(),
            });

            expect(ref).toBeDefined();
            expect(ref.path).toContain('.log');
            expect(fs.existsSync(ref.path)).toBe(true);

            // Verify content includes error messages
            const content = fs.readFileSync(ref.path, 'utf-8');
            expect(content).toContain('timeout exceeded');
            expect(content).toContain('failed');
        });

        it('should persist a log file on Stopped status', async () => {
            const records = createSampleRecords();
            const writer = new ExecutionLogWriter(workspaceRoot);

            const ref = await writer.writeLog({
                workflowName: 'stopped-workflow',
                status: ExecutionStatus.Stopped,
                state: { partial: true },
                nodeRecords: records,
                startTime: Date.now() - 2000,
                endTime: Date.now(),
            });

            expect(ref).toBeDefined();
            expect(fs.existsSync(ref.path)).toBe(true);
        });

        it('should include full execution context in log content', async () => {
            const records = new Map<string, NodeExecutionRecord>();
            records.set('agent1', {
                nodeId: 'agent1',
                nodeName: 'Code Agent',
                status: NodeStatus.Completed,
                startTime: Date.now() - 4000,
                endTime: Date.now() - 1000,
                duration: 3000,
                prompt: 'Review the code in src/',
                contextIn: { input_data: 'test-value' },
                contextOut: { review_result: 'passed' },
                filesModified: ['src/file.ts'],
                logs: ['invoking agent', 'agent completed'],
                errors: [],
                structuredOutput: { score: 95, passed: true },
            });

            const writer = new ExecutionLogWriter(workspaceRoot);

            const ref = await writer.writeLog({
                workflowName: 'context-workflow',
                status: ExecutionStatus.Completed,
                state: { agent1_output: 'some output', agent1_success: true, custom_key: 'custom_value' },
                nodeRecords: records,
                startTime: Date.now() - 5000,
                endTime: Date.now(),
            });

            const content = fs.readFileSync(ref.path, 'utf-8');

            // Verify execution context is included
            expect(content).toContain('Code Agent');
            expect(content).toContain('Review the code in src/');
            expect(content).toContain('test-value');
            expect(content).toContain('passed');
            expect(content).toContain('src/file.ts');
            expect(content).toContain('invoking agent');
            expect(content).toContain('agent completed');
            expect(content).toContain('agent1_output');
            expect(content).toContain('custom_value');
        });

        it('should return a LogReference with id and absolute path', async () => {
            const records = createSampleRecords();
            const writer = new ExecutionLogWriter(workspaceRoot);

            const ref = await writer.writeLog({
                workflowName: 'ref-workflow',
                status: ExecutionStatus.Completed,
                state: {},
                nodeRecords: records,
                startTime: Date.now() - 1000,
                endTime: Date.now(),
            });

            expect(ref.id).toBeDefined();
            expect(typeof ref.id).toBe('string');
            expect(ref.path).toBeDefined();
            expect(path.isAbsolute(ref.path)).toBe(true);
        });
    });

    describe('retention policy', () => {

        it('should retain only the latest 100 logs by default', async () => {
            const records = createSampleRecords();
            const writer = new ExecutionLogWriter(workspaceRoot);

            // Write 105 logs
            const refs: LogReference[] = [];
            for (let i = 0; i < 105; i++) {
                const ref = await writer.writeLog({
                    workflowName: `workflow-${i}`,
                    status: ExecutionStatus.Completed,
                    state: {},
                    nodeRecords: records,
                    startTime: Date.now() - 1000,
                    endTime: Date.now(),
                });
                refs.push(ref);
                // Small delay to ensure unique timestamps
                await new Promise(r => setTimeout(r, 2));
            }

            // Only the last 100 should remain
            const logDir = path.join(workspaceRoot, '.workflow', 'logs');
            const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
            expect(files.length).toBe(100);

            // The oldest 5 files (refs[0]..refs[4]) should have been deleted
            for (let i = 0; i < 5; i++) {
                expect(fs.existsSync(refs[i].path)).toBe(false);
            }

            // The newest 100 should still exist
            for (let i = 5; i < 105; i++) {
                expect(fs.existsSync(refs[i].path)).toBe(true);
            }
        });

        it('should respect a custom retention limit', async () => {
            const records = createSampleRecords();
            const writer = new ExecutionLogWriter(workspaceRoot, 5);

            const refs: LogReference[] = [];
            for (let i = 0; i < 10; i++) {
                const ref = await writer.writeLog({
                    workflowName: `workflow-${i}`,
                    status: ExecutionStatus.Completed,
                    state: {},
                    nodeRecords: records,
                    startTime: Date.now() - 1000,
                    endTime: Date.now(),
                });
                refs.push(ref);
                await new Promise(r => setTimeout(r, 2));
            }

            const logDir = path.join(workspaceRoot, '.workflow', 'logs');
            const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
            expect(files.length).toBe(5);
        });
    });

    describe('shouldWriteLog', () => {

        it('should return true for Completed status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Completed)).toBe(true);
        });

        it('should return true for Failed status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Failed)).toBe(true);
        });

        it('should return true for Stopped status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Stopped)).toBe(true);
        });

        it('should return false for Idle status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Idle)).toBe(false);
        });

        it('should return false for Running status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Running)).toBe(false);
        });

        it('should return false for Paused status', () => {
            expect(ExecutionLogWriter.shouldWriteLog(ExecutionStatus.Paused)).toBe(false);
        });
    });
});

function createSampleRecords(): Map<string, NodeExecutionRecord> {
    const records = new Map<string, NodeExecutionRecord>();
    records.set('start', {
        nodeId: 'start',
        nodeName: 'Start',
        status: NodeStatus.Completed,
        startTime: Date.now() - 5000,
        endTime: Date.now() - 4990,
        duration: 10,
        logs: ['started workflow'],
        errors: [],
    });
    records.set('end', {
        nodeId: 'end',
        nodeName: 'End',
        status: NodeStatus.Completed,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        duration: 1000,
        logs: [],
        errors: [],
    });
    return records;
}
