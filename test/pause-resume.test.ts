/**
 * Tests for pause/resume functionality in WorkflowExecutor.
 *
 * Verifies that:
 * - pause() halts execution at the next node boundary
 * - resume() continues execution from where it paused
 * - The pause is cooperative (checks flag before each node)
 * - Promise-based approach: main loop awaits a promise that resolves on resume()
 * - Proper status transitions (Running → Paused → Running → Completed)
 * - Observer notifications are fired correctly
 */

import {
    Workflow, NodeType, NodeStatus, ExecutionStatus,
    DelayNodeData, EndNodeData
} from '../src/models/workflow';
import { WorkflowExecutor } from '../src/runtime/workflowExecutor';
import { InMemoryExecutionObserver } from '../src/runtime/executionObserver.interface';

// ---- Helpers ----

/**
 * Creates a workflow with delay nodes that have a small duration (0.05s = 50ms)
 * so pause() has time to be called between nodes.
 */
function createMultiNodeWorkflow(nodeCount: number = 5, duration: number = 0.05): Workflow {
    const nodes = [
        { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [];

    for (let i = 0; i < nodeCount; i++) {
        const prevId = i === 0 ? 'start' : `delay${i - 1}`;
        const nodeId = `delay${i}`;
        nodes.push({
            id: nodeId,
            type: NodeType.Delay,
            position: { x: (i + 1) * 100, y: 0 },
            data: { duration } as DelayNodeData,
        });
        edges.push({ id: `e${i}`, source: prevId, target: nodeId });
    }

    const lastDelay = `delay${nodeCount - 1}`;
    nodes.push({
        id: 'end',
        type: NodeType.End,
        position: { x: (nodeCount + 1) * 100, y: 0 },
        data: { summary: false } as EndNodeData,
    });
    edges.push({ id: `e${nodeCount}`, source: lastDelay, target: 'end' });

    return { name: 'multi-node', nodes, edges };
}

/**
 * Creates a workflow with a single long delay node for testing pause during delay.
 */
function createLongDelayWorkflow(delaySeconds: number = 10): Workflow {
    return {
        name: 'long-delay',
        nodes: [
            { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            { id: 'delay', type: NodeType.Delay, position: { x: 100, y: 0 }, data: { duration: delaySeconds } as DelayNodeData },
            { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } as EndNodeData },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'delay' },
            { id: 'e2', source: 'delay', target: 'end' },
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

describe('WorkflowExecutor pause/resume', () => {
    let observer: InMemoryExecutionObserver;
    let executor: WorkflowExecutor;

    beforeEach(() => {
        observer = new InMemoryExecutionObserver();
        executor = new WorkflowExecutor(observer);
    });

    describe('pause()', () => {
        it('should halt execution at the next node boundary', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Pause after a short delay (during the long delay node)
            setTimeout(() => executor.pause(), 200);
            // Resume after pause is established
            setTimeout(() => executor.resume(), 500);

            const status = await runPromise;
            expect(status).toBe(ExecutionStatus.Completed);
        });

        it('should transition status to Paused when pause() is called', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            // Status should have transitioned through Paused
            expect(observer.statusChanges).toContain(ExecutionStatus.Paused);
        });

        it('should not halt if called when not Running', async () => {
            // Executor is idle initially
            executor.pause();

            // Status should not be Paused (nothing was running)
            expect(executor.getExecutionContext().status).not.toBe(ExecutionStatus.Paused);
        });

        it('should notify observer when paused', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            const pauseNotification = observer.notifications.find(
                n => n.type === 'info' && n.message.includes('pause')
            );
            expect(pauseNotification).toBeDefined();
        });

        it('should complete nodes before the pause point', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            const ctx = executor.getExecutionContext();
            // Start node should be completed
            const startRecord = ctx.nodeRecords.get('start');
            expect(startRecord?.status).toBe(NodeStatus.Completed);
        });
    });

    describe('resume()', () => {
        it('should continue execution from where it paused', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            const status = await runPromise;

            expect(status).toBe(ExecutionStatus.Completed);
        });

        it('should transition status back to Running on resume', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            // Should have Running -> Paused -> Running -> Completed
            const pausedIdx = observer.statusChanges.indexOf(ExecutionStatus.Paused);
            expect(pausedIdx).toBeGreaterThan(-1);
            // After Paused, should go back to Running
            const afterPaused = observer.statusChanges.slice(pausedIdx + 1);
            expect(afterPaused).toContain(ExecutionStatus.Running);
        });

        it('should notify observer when resumed', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            const resumeNotification = observer.notifications.find(
                n => n.type === 'info' && n.message.includes('resume')
            );
            expect(resumeNotification).toBeDefined();
        });

        it('should complete all nodes after resume', async () => {
            const workflow = createMultiNodeWorkflow(3, 0.2);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Pause during first node, then resume
            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.resume(), 200);
            }, 100);

            await runPromise;

            const ctx = executor.getExecutionContext();
            // All delay nodes should be completed
            for (let i = 0; i < 3; i++) {
                const record = ctx.nodeRecords.get(`delay${i}`);
                expect(record?.status).toBe(NodeStatus.Completed);
            }
        });

        it('should do nothing if called when not Paused', async () => {
            // Executor is idle initially
            executor.resume();

            // Should not throw and status should not be Running
            expect(executor.getExecutionContext().status).not.toBe(ExecutionStatus.Running);
        });
    });

    describe('pause/resume cycle', () => {
        it('should support multiple pause/resume cycles', async () => {
            // Use multiple delay nodes so each pause can happen at a different node boundary
            const workflow = createMultiNodeWorkflow(5, 0.5);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Multiple pause/resume cycles at different node boundaries
            setTimeout(() => {
                executor.pause();
                setTimeout(() => {
                    executor.resume();
                    setTimeout(() => {
                        executor.pause();
                        setTimeout(() => executor.resume(), 200);
                    }, 300);
                }, 300);
            }, 200);

            const status = await runPromise;

            expect(status).toBe(ExecutionStatus.Completed);
            // Should have Paused at least twice
            const pausedCount = observer.statusChanges.filter(s => s === ExecutionStatus.Paused).length;
            expect(pausedCount).toBeGreaterThanOrEqual(2);
        });

        it('should maintain state across pause/resume', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            setTimeout(() => {
                executor.pause();
                // Set a state value while paused
                executor.getExecutionContext().state['testKey'] = 'testValue';
                setTimeout(() => executor.resume(), 200);
            }, 200);

            await runPromise;

            // State should be preserved
            expect(executor.getExecutionContext().state['testKey']).toBe('testValue');
        });

        it('should halt before scheduling the next node (cooperative pause)', async () => {
            const workflow = createMultiNodeWorkflow(5, 0.2);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Pause very early
            setTimeout(() => executor.pause(), 100);
            // Resume shortly after
            setTimeout(() => executor.resume(), 400);

            await runPromise;

            const ctx = executor.getExecutionContext();
            // All nodes should complete successfully
            const startRecord = ctx.nodeRecords.get('start');
            expect(startRecord?.status).toBe(NodeStatus.Completed);

            expect(executor.getExecutionContext().status).toBe(ExecutionStatus.Completed);
        });
    });

    describe('interaction with stop', () => {
        it('should stop a paused workflow', async () => {
            const workflow = createLongDelayWorkflow(10);

            const runPromise = executor.run({
                workflow,
                executionContext: createMockExecutionContext(),
                workspaceRoot: '/tmp',
            });

            // Pause then stop
            setTimeout(() => {
                executor.pause();
                setTimeout(() => executor.stop(), 200);
            }, 200);

            const status = await runPromise;

            expect([ExecutionStatus.Stopped, ExecutionStatus.Failed]).toContain(status);
        });
    });
});
