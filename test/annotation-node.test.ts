/**
 * Tests for outer loop annotation nodes (Note, Process, Decision).
 *
 * These are non-executable visual annotations that should:
 * - Serialize/deserialize through YAML correctly
 * - Be excluded from validation reachability checks
 * - Be skipped during runtime execution
 * - Be distinguishable via isAnnotationNode helper
 */

import { ExecutionStatus, NodeType, isAnnotationNode } from '../src/models/workflow';
import { workflowToYaml, yamlToWorkflow } from '../src/utils/yamlSerializer';
import { validateWorkflow } from '../src/utils/workflowValidator';
import { WorkflowExecutor } from '../src/runtime/workflowExecutor';
import { InMemoryExecutionObserver } from '../src/runtime/executionObserver.interface';

describe('isAnnotationNode helper', () => {
    it('returns true for Note type', () => {
        expect(isAnnotationNode(NodeType.Note)).toBe(true);
    });

    it('returns true for Process type', () => {
        expect(isAnnotationNode(NodeType.Process)).toBe(true);
    });

    it('returns true for Decision type', () => {
        expect(isAnnotationNode(NodeType.Decision)).toBe(true);
    });

    it('returns false for executable types', () => {
        expect(isAnnotationNode(NodeType.Start)).toBe(false);
        expect(isAnnotationNode(NodeType.End)).toBe(false);
        expect(isAnnotationNode(NodeType.Agent)).toBe(false);
        expect(isAnnotationNode(NodeType.Condition)).toBe(false);
        expect(isAnnotationNode(NodeType.HumanApproval)).toBe(false);
        expect(isAnnotationNode(NodeType.Delay)).toBe(false);
        expect(isAnnotationNode(NodeType.Loop)).toBe(false);
    });
});

describe('YAML serialization of annotation nodes', () => {
    it('serializes and deserializes a Note node', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'note1',
                    type: NodeType.Note,
                    position: { x: 100, y: 0 },
                    data: { text: 'This is a note', description: 'optional context' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        const restored = yamlToWorkflow(yaml);

        const note = restored.nodes.find(n => n.id === 'note1');
        expect(note).toBeDefined();
        expect(note!.type).toBe(NodeType.Note);
        expect((note!.data as any).text).toBe('This is a note');
        expect((note!.data as any).description).toBe('optional context');
    });

    it('serializes and deserializes a Process node', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'proc1',
                    type: NodeType.Process,
                    position: { x: 100, y: 0 },
                    data: { title: 'Review Phase', description: 'Stakeholder review process' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        const restored = yamlToWorkflow(yaml);

        const proc = restored.nodes.find(n => n.id === 'proc1');
        expect(proc).toBeDefined();
        expect(proc!.type).toBe(NodeType.Process);
        expect((proc!.data as any).title).toBe('Review Phase');
        expect((proc!.data as any).description).toBe('Stakeholder review process');
    });

    it('serializes and deserializes a Decision node', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'dec1',
                    type: NodeType.Decision,
                    position: { x: 100, y: 0 },
                    data: { question: 'Build or buy?', options: ['Build', 'Buy', 'Partner'] },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        const restored = yamlToWorkflow(yaml);

        const dec = restored.nodes.find(n => n.id === 'dec1');
        expect(dec).toBeDefined();
        expect(dec!.type).toBe(NodeType.Decision);
        expect((dec!.data as any).question).toBe('Build or buy?');
        expect((dec!.data as any).options).toEqual(['Build', 'Buy', 'Partner']);
    });
});

describe('Validation with annotation nodes', () => {
    it('does not warn about orphan annotation nodes', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'note1',
                    type: NodeType.Note,
                    position: { x: 300, y: 200 },
                    data: { text: 'Disconnected note' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const orphanWarnings = errors.filter(e => e.message.includes('not connected'));
        expect(orphanWarnings.length).toBe(0);
    });

    it('allows annotation nodes without affecting Start/End counts', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'proc1',
                    type: NodeType.Process,
                    position: { x: 100, y: 0 },
                    data: { title: 'A process' },
                },
                {
                    id: 'dec1',
                    type: NodeType.Decision,
                    position: { x: 200, y: 0 },
                    data: { question: 'A decision?' },
                },
                { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter(e => e.message.includes('Start node'));
        const endErrors = errors.filter(e => e.message.includes('End node'));
        expect(startErrors.length).toBe(0);
        expect(endErrors.length).toBe(0);
    });

    it('passes validation with only annotation nodes connected to executable flow', () => {
        const workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'note1',
                    type: NodeType.Note,
                    position: { x: 100, y: 0 },
                    data: { text: 'Context note' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'note1' },
                { id: 'e2', source: 'note1', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        expect(fatalErrors.length).toBe(0);
    });
});

describe('Runtime skips annotation nodes', () => {
    let observer: InMemoryExecutionObserver;
    let executor: WorkflowExecutor;

    beforeEach(() => {
        observer = new InMemoryExecutionObserver();
        executor = new WorkflowExecutor(observer);
    });

    it('should not initialize execution counts for annotation nodes', async () => {
        const workflow = {
            name: 'annotated',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'note1',
                    type: NodeType.Note,
                    position: { x: 50, y: 0 },
                    data: { text: 'A note' },
                },
                {
                    id: 'proc1',
                    type: NodeType.Process,
                    position: { x: 100, y: 0 },
                    data: { title: 'A process' },
                },
                {
                    id: 'dec1',
                    type: NodeType.Decision,
                    position: { x: 150, y: 0 },
                    data: { question: 'A decision?' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const mockContext = {
            toolInvocationToken: {} as any,
            cancellationToken: {
                isCancellationRequested: false,
                onCancellationRequested: (_listener: () => void) => ({ dispose: () => {} }),
            },
        };

        await executor.run({
            workflow,
            executionContext: mockContext as any,
            workspaceRoot: '/tmp',
        });

        const ctx = executor.getExecutionContext();

        // Executable nodes should have execution counts
        expect(ctx.nodeExecutionCounts.has('start')).toBe(true);
        expect(ctx.nodeExecutionCounts.has('end')).toBe(true);

        // Annotation nodes should NOT have execution counts
        expect(ctx.nodeExecutionCounts.has('note1')).toBe(false);
        expect(ctx.nodeExecutionCounts.has('proc1')).toBe(false);
        expect(ctx.nodeExecutionCounts.has('dec1')).toBe(false);
    });

    it('executes workflow with annotation nodes without executing them', async () => {
        const workflow = {
            name: 'annotated',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'note1',
                    type: NodeType.Note,
                    position: { x: 50, y: 0 },
                    data: { text: 'I should not be executed' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'note1' },
                { id: 'e2', source: 'note1', target: 'end' },
            ],
        };

        const mockContext = {
            toolInvocationToken: {} as any,
            cancellationToken: {
                isCancellationRequested: false,
                onCancellationRequested: (_listener: () => void) => ({ dispose: () => {} }),
            },
        };

        const status = await executor.run({
            workflow,
            executionContext: mockContext as any,
            workspaceRoot: '/tmp',
        });

        // Workflow should complete (annotation nodes are skipped in traversal)
        expect(status).toBe(ExecutionStatus.Completed);

        // Note node should NOT have an execution record
        const ctx = executor.getExecutionContext();
        expect(ctx.nodeRecords.has('note1')).toBe(false);
    });

    it('traverses through annotation nodes to reach executable nodes', async () => {
        const workflow = {
            name: 'annotated-flow',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'proc1',
                    type: NodeType.Process,
                    position: { x: 50, y: 0 },
                    data: { title: 'Process step' },
                },
                {
                    id: 'dec1',
                    type: NodeType.Decision,
                    position: { x: 100, y: 0 },
                    data: { question: 'Decision point?' },
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'proc1' },
                { id: 'e2', source: 'proc1', target: 'dec1' },
                { id: 'e3', source: 'dec1', target: 'end' },
            ],
        };

        const mockContext = {
            toolInvocationToken: {} as any,
            cancellationToken: {
                isCancellationRequested: false,
                onCancellationRequested: (_listener: () => void) => ({ dispose: () => {} }),
            },
        };

        const status = await executor.run({
            workflow,
            executionContext: mockContext as any,
            workspaceRoot: '/tmp',
        });

        expect(status).toBe(ExecutionStatus.Completed);

        // Annotation nodes should not have execution records
        const ctx = executor.getExecutionContext();
        expect(ctx.nodeRecords.has('proc1')).toBe(false);
        expect(ctx.nodeRecords.has('dec1')).toBe(false);
        // End should have been reached
        expect(ctx.nodeRecords.has('end')).toBe(true);
    });
});
