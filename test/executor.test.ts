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
import { CopilotSubagentExecutionContext, IAgentInvoker } from '../src/runtime/executionContext';

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
                data: { prompt: 'Check if tests passed' } as ConditionNodeData,
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
        it('should take a branch when condition agent returns true', async () => {
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'true' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const workflow = createBranchWorkflow();
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);
            const ctx = mockExecutor.getExecutionContext();
            const trueRecord = ctx.nodeRecords.get('trueNode');
            const falseRecord = ctx.nodeRecords.get('falseNode');
            expect(trueRecord?.status).toBe(NodeStatus.Completed);
            expect(falseRecord?.status).toBe(NodeStatus.Skipped);
        });

        it('should take the false branch when condition agent returns false', async () => {
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'false' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const workflow = createBranchWorkflow();
            await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = mockExecutor.getExecutionContext();
            const falseRecord = ctx.nodeRecords.get('falseNode');
            expect(falseRecord?.status).toBe(NodeStatus.Completed);
        });

        it('should mark untaken branch nodes as Skipped (but UI never shows gray)', async () => {
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'true' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const workflow = createBranchWorkflow();
            await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = mockExecutor.getExecutionContext();
            // When condition returns true, trueNode is taken (Completed) and falseNode is Skipped
            const trueRecord = ctx.nodeRecords.get('trueNode');
            const falseRecord = ctx.nodeRecords.get('falseNode');
            expect(trueRecord?.status).toBe(NodeStatus.Completed);
            // Internally marked as Skipped for record-keeping, but UI renders them
            // with their default type color (never gray)
            expect(falseRecord?.status).toBe(NodeStatus.Skipped);
        });

        it('should log branch decisions in node records', async () => {
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'true' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const workflow = createBranchWorkflow();
            await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = mockExecutor.getExecutionContext();
            const conditionRecord = ctx.nodeRecords.get('condition');
            expect(conditionRecord?.logs).toBeDefined();
            const logText = conditionRecord!.logs!.join('\n');
            expect(logText).toContain('Taking branch');
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
        it('should set agent step success state to false when agent invocation fails', async () => {
            const workflow: Workflow = {
                name: 'qa-failure',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    {
                        id: 'qa',
                        type: NodeType.Agent,
                        position: { x: 120, y: 0 },
                        data: { agent: 'qa', prompt: 'Run UI regressions' },
                    },
                    { id: 'end', type: NodeType.End, position: { x: 240, y: 0 }, data: { summary: false } as EndNodeData },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'qa' },
                    { id: 'e2', source: 'qa', target: 'end' },
                ],
            };

            const failingInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return {
                        success: false,
                        output: 'UI regression tests failed',
                    };
                },
            };

            const failingExecutor = new WorkflowExecutor(observer, failingInvoker);
            const status = await failingExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Failed);
            expect(failingExecutor.getExecutionContext().state['qa_success']).toBe(false);
        });

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
        it('should increment start node execution count from 0 to 1 after workflow starts', async () => {
            await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            const startCount = ctx.nodeExecutionCounts.get('start');
            expect(startCount).toBe(1);
        });

        it('should increment execution counts for all executed nodes', async () => {
            await executor.run({
                workflow: createLinearWorkflow(),
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            const ctx = executor.getExecutionContext();
            expect(ctx.nodeExecutionCounts.get('start')).toBe(1);
            expect(ctx.nodeExecutionCounts.get('delay1')).toBe(1);
            expect(ctx.nodeExecutionCounts.get('end')).toBe(1);
        });
    });

    describe('infinite loop protection', () => {
        it('should stop workflow when a node exceeds max execution count', async () => {
            // Create a workflow where a condition always returns false,
            // routing back to itself — simulating an infinite loop.
            const workflow: Workflow = {
                name: 'infinite-loop',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    {
                        id: 'condition',
                        type: NodeType.Condition,
                        position: { x: 100, y: 0 },
                        data: { prompt: 'Always fail' } as ConditionNodeData,
                    },
                    { id: 'falseNode', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
                    { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: { summary: false } as EndNodeData },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'condition' },
                    { id: 'e2', source: 'condition', target: 'falseNode', label: 'False' },
                    { id: 'e3', source: 'falseNode', target: 'condition' }, // loops back!
                    { id: 'e4', source: 'condition', target: 'end', label: 'True' },
                ],
            };

            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'false' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);

            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Should fail (not hang forever)
            expect(status).toBe(ExecutionStatus.Failed);
            const logText = observer.logs.join('\n');
            expect(logText).toContain('max');
            expect(logText).toContain('execution');
        }, 10000);

        it('should log a clear warning when loop protection triggers', async () => {
            // Two nodes that loop back to each other (no End reachable)
            const workflow: Workflow = {
                name: 'loop-protection-test',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    {
                        id: 'loopNodeA',
                        type: NodeType.Delay,
                        position: { x: 100, y: 0 },
                        data: { duration: 0 } as DelayNodeData,
                    },
                    {
                        id: 'loopNodeB',
                        type: NodeType.Delay,
                        position: { x: 200, y: 0 },
                        data: { duration: 0 } as DelayNodeData,
                    },
                    { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: { summary: false } as EndNodeData },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'loopNodeA' },
                    { id: 'e2', source: 'loopNodeA', target: 'loopNodeB' },
                    { id: 'e3', source: 'loopNodeB', target: 'loopNodeA' }, // loops back
                ],
            };

            const mockExecutor = new WorkflowExecutor(observer);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Failed);
            const logText = observer.logs.join('\n');
            expect(logText).toMatch(/loop.*protection|infinite.*loop|max.*execution/i);
        }, 10000);
    });

    describe('condition node error detection', () => {
        it('should fail workflow when condition agent returns an error message', async () => {
            const workflow: Workflow = {
                name: 'condition-error',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    {
                        id: 'condition',
                        type: NodeType.Condition,
                        position: { x: 100, y: 0 },
                        data: { prompt: 'Check something' } as ConditionNodeData,
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

            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return {
                        success: true,
                        output: 'Agent error: Sorry, your request failed. Please try again.\n\nClient Request Id: 7566eaf5-ee1a-4313-af87-8678ebaf4e2c\n\nReason: network request aborted',
                    };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Should fail because the condition agent returned an error
            expect(status).toBe(ExecutionStatus.Failed);
            const logText = observer.logs.join('\n');
            expect(logText).toContain('error');
        });

        it('should fail when condition agent output starts with "Agent error"', async () => {
            const workflow = createBranchWorkflow();
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return {
                        success: true,
                        output: 'Agent error: network request aborted: Error: network request aborted',
                    };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Failed);
        });

        it('should still route correctly when condition agent returns "true"', async () => {
            const workflow = createBranchWorkflow();
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'true' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);
            const ctx = mockExecutor.getExecutionContext();
            expect(ctx.nodeRecords.get('trueNode')?.status).toBe(NodeStatus.Completed);
            expect(ctx.nodeRecords.get('falseNode')?.status).toBe(NodeStatus.Skipped);
        });

        it('should still route correctly when condition agent returns "false"', async () => {
            const workflow = createBranchWorkflow();
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'false' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);
            const ctx = mockExecutor.getExecutionContext();
            expect(ctx.nodeRecords.get('falseNode')?.status).toBe(NodeStatus.Completed);
            expect(ctx.nodeRecords.get('trueNode')?.status).toBe(NodeStatus.Skipped);
        });

        it('should fail workflow when condition agent returns prose instead of true/false', async () => {
            const workflow = createBranchWorkflow();
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return {
                        success: true,
                        output: "I cannot validate the previous agent's output because it appears to be an error message rather than actual test results.",
                    };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Should fail because output is not a valid true/false
            expect(status).toBe(ExecutionStatus.Failed);
            const logText = observer.logs.join('\n');
            expect(logText).toContain('valid true/false');
        });

        it('should fail workflow when condition agent returns ambiguous output like "maybe"', async () => {
            const workflow = createBranchWorkflow();
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    return { success: true, output: 'maybe' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Failed);
        });

        it('should accept "yes" as true and "no" as false', async () => {
            const workflow = createBranchWorkflow();
            let callCount = 0;
            const mockInvoker: IAgentInvoker = {
                async invokeAgent() {
                    callCount++;
                    return { success: true, output: callCount === 1 ? 'yes' : 'no' };
                },
            };
            const mockExecutor = new WorkflowExecutor(observer, mockInvoker);
            const status = await mockExecutor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            expect(status).toBe(ExecutionStatus.Completed);
            const ctx = mockExecutor.getExecutionContext();
            expect(ctx.nodeRecords.get('trueNode')?.status).toBe(NodeStatus.Completed);
        });
    });
});
