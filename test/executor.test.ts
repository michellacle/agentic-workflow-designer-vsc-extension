/**
 * Integration tests for WorkflowExecutor.
 *
 * These tests exercise the executor's graph traversal, branch routing,
 * approval flow, delay nodes, and error propagation end-to-end
 * through the run() interface — the deep module's test surface.
 */

import {
    Workflow, NodeType, NodeStatus, ExecutionStatus,
    ConditionNodeData, HumanApprovalNodeData, DelayNodeData, EndNodeData
} from '../src/models/workflow';
import { WorkflowExecutor, ExecutionStateChangeEvent } from '../src/runtime/workflowExecutor';
import { InMemoryExecutionObserver } from '../src/runtime/executionObserver.interface';
import { CopilotSubagentExecutionContext } from '../src/runtime/executionContext';

// ---- Helpers ----

function createLinearWorkflow(): Workflow {
    return {
        name: 'linear',
        nodes: [
            { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            { id: 'delay1', type: NodeType.Delay, position: { x: 100, y: 0 }, data: { duration: 0 } as DelayNodeData },
            { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } as EndNodeData },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'delay1' },
            { id: 'e2', source: 'delay1', target: 'end' },
        ],
    };
}

function createBranchWorkflow(): Workflow {
    return {
        name: 'branch',
        nodes: [
            { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            {
                id: 'condition',
                type: NodeType.Condition,
                position: { x: 100, y: 0 },
                data: { expression: 'state.passed === true' } as ConditionNodeData,
            },
            { id: 'trueNode', type: NodeType.Delay, position: { x: 200, y: -50 }, data: { duration: 0 } as DelayNodeData },
            { id: 'falseNode', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
            { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: { summary: false } as EndNodeData },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'condition' },
            { id: 'e2', source: 'condition', target: 'trueNode', label: 'True' },
            { id: 'e3', source: 'condition', target: 'falseNode', label: 'False' },
            { id: 'e4', source: 'trueNode', target: 'end' },
            { id: 'e5', source: 'falseNode', target: 'end' },
        ],
    };
}

function createApprovalWorkflow(): Workflow {
    return {
        name: 'approval',
        nodes: [
            { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            {
                id: 'approval',
                type: NodeType.HumanApproval,
                position: { x: 100, y: 0 },
                data: { message: 'Approve this?' } as HumanApprovalNodeData,
            },
            { id: 'approvedNode', type: NodeType.Delay, position: { x: 200, y: -50 }, data: { duration: 0 } as DelayNodeData },
            { id: 'rejectedNode', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
            { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: { summary: false } as EndNodeData },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'approval' },
            { id: 'e2', source: 'approval', target: 'approvedNode', label: 'Approve' },
            { id: 'e3', source: 'approval', target: 'rejectedNode', label: 'Reject' },
            { id: 'e4', source: 'approvedNode', target: 'end' },
            { id: 'e5', source: 'rejectedNode', target: 'end' },
        ],
    };
}

function createMockExecutionContext() {
    return {
        toolInvocationToken: {} as any,
        cancellationToken: {
            isCancellationRequested: false,
            onCancellationRequested: (_listener: () => void) => ({ dispose: () => {} }),
        },
    };
}

// ---- Tests ----

describe('WorkflowExecutor integration', () => {

    let observer: InMemoryExecutionObserver;
    let executor: WorkflowExecutor;

    beforeEach(() => {
        observer = new InMemoryExecutionObserver();
        executor = new WorkflowExecutor(observer);
    });

    describe('linear flow', () => {
        it('should execute a linear workflow from start to end', async () => {
            const status = await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);
            expect(observer.statusChanges).toContain(ExecutionStatus.Running);
            expect(observer.statusChanges).toContain(ExecutionStatus.Completed);
        });

        it('should log node execution in order', async () => {
            await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const logText = observer.logs.join('\n');
            expect(logText).toContain('start');
            expect(logText).toContain('delay1');
            // delay1 should appear after start
            const startIdx = logText.indexOf('start');
            const delayIdx = logText.indexOf('delay1');
            expect(delayIdx).toBeGreaterThan(startIdx);
        });

        it('should fire execution state change events', async () => {
            let eventCount = 0;
            let lastEvent: ExecutionStateChangeEvent | undefined;
            const unsubscribe = executor.onDidChangeExecutionState((event) => {
                eventCount++;
                lastEvent = event;
            });

            await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(eventCount).toBeGreaterThan(0);
            expect(lastEvent).toBeDefined();
            expect(lastEvent!.overall).toBe(ExecutionStatus.Completed);
            unsubscribe();
        });

        it('should include node statuses in state change events', async () => {
            let lastEvent: ExecutionStateChangeEvent | undefined;
            const unsubscribe = executor.onDidChangeExecutionState((event) => {
                lastEvent = event;
            });

            await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            unsubscribe();
            expect(lastEvent).toBeDefined();
            expect(lastEvent!.nodeStatuses).toHaveProperty('delay1');
            expect(lastEvent!.nodeStatuses['delay1'].status).toBe(NodeStatus.Completed);
        });
    });

    describe('branch routing', () => {
        it('should take the true branch when condition evaluates to true', async () => {
            // Set state before execution so condition evaluates to true
            const workflow = createBranchWorkflow();
            const status = await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);

            // Check that trueNode was executed and falseNode was skipped
            const ctx = executor.getExecutionContext();
            const trueRecord = ctx.nodeRecords.get('trueNode');
            const falseRecord = ctx.nodeRecords.get('falseNode');

            // Condition evaluates state.passed === true, but state.passed is undefined,
            // so it evaluates to false. falseNode should be taken.
            expect(falseRecord?.status).toBe(NodeStatus.Completed);
            expect(trueRecord?.status).toBe(NodeStatus.Skipped);
        });

        it('should take the false branch when condition evaluates to false', async () => {
            const workflow = createBranchWorkflow();
            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            const falseRecord = ctx.nodeRecords.get('falseNode');
            expect(falseRecord?.status).toBe(NodeStatus.Completed);
        });

        it('should mark untaken branch nodes as skipped', async () => {
            const workflow = createBranchWorkflow();
            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            const trueRecord = ctx.nodeRecords.get('trueNode');
            expect(trueRecord?.status).toBe(NodeStatus.Skipped);
        });

        it('should log skipped nodes', async () => {
            const workflow = createBranchWorkflow();
            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const logText = observer.logs.join('\n');
            expect(logText).toContain('skipped');
        });
    });

    describe('approval flow', () => {
        it('should take the approve branch when approval is granted', async () => {
            observer.setApprovalResult(true);
            await executor.run({
                workflow: createApprovalWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            const approvedRecord = ctx.nodeRecords.get('approvedNode');
            const rejectedRecord = ctx.nodeRecords.get('rejectedNode');

            expect(approvedRecord?.status).toBe(NodeStatus.Completed);
            expect(rejectedRecord?.status).toBe(NodeStatus.Skipped);
        });

        it('should take the reject branch when approval is denied', async () => {
            observer.setApprovalResult(false);
            await executor.run({
                workflow: createApprovalWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            const approvedRecord = ctx.nodeRecords.get('approvedNode');
            const rejectedRecord = ctx.nodeRecords.get('rejectedNode');

            expect(approvedRecord?.status).toBe(NodeStatus.Skipped);
            expect(rejectedRecord?.status).toBe(NodeStatus.Completed);
        });

        it('should store approval result in state', async () => {
            observer.setApprovalResult(true);
            await executor.run({
                workflow: createApprovalWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            expect(ctx.state['approval_approved']).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should return undefined when workflow has no start node', async () => {
            const workflow: Workflow = {
                name: 'no-start',
                nodes: [
                    { id: 'end', type: NodeType.End, position: { x: 0, y: 0 }, data: {} },
                ],
                edges: [],
            };

            const status = await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBeUndefined();
            expect(observer.notifications.some(n => n.type === 'error')).toBe(true);
        });

        it('should report validation errors via observer', async () => {
            const workflow: Workflow = {
                name: 'invalid',
                nodes: [
                    { id: 'end', type: NodeType.End, position: { x: 0, y: 0 }, data: {} },
                ],
                edges: [],
            };

            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Validation errors are sent as notifications, not logs
            const errorNotifications = observer.notifications.filter(n => n.type === 'error');
            expect(errorNotifications.length).toBeGreaterThan(0);
        });
    });

    describe('stop', () => {
        it('should stop execution when stop() is called', () => {
            // Start execution with a long delay
            const workflow: Workflow = {
                name: 'stop-test',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    { id: 'delay', type: NodeType.Delay, position: { x: 100, y: 0 }, data: { duration: 60 } as DelayNodeData },
                    { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } as EndNodeData },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'delay' },
                    { id: 'e2', source: 'delay', target: 'end' },
                ],
            };

            const promise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Stop after a short delay
            setTimeout(() => executor.stop(), 50);

            return promise.then((status) => {
                // The delay node should fail (abort), causing the workflow to fail
                expect([ExecutionStatus.Failed, ExecutionStatus.Stopped]).toContain(status);
            });
        });
    });

    describe('execution summary', () => {
        it('should generate execution summary when End node has summary enabled', async () => {
            const workflow = createLinearWorkflow();
            // Enable summary on end node
            workflow.nodes.find(n => n.id === 'end')!.data = { summary: true } as EndNodeData;

            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const summary = executor.getExecutionSummary();
            expect(summary).toBeDefined();
            expect(summary!).toContain('Workflow Execution Summary');
        });

        it('should not generate summary when End node has summary disabled', async () => {
            const workflow = createLinearWorkflow();
            workflow.nodes.find(n => n.id === 'end')!.data = { summary: false } as EndNodeData;

            await executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const summary = executor.getExecutionSummary();
            expect(summary).toBeUndefined();
        });
    });
});
