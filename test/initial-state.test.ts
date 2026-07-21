/**
 * Tests for initial workflow state defined in the YAML schema.
 *
 * Covers:
 * - Workflow interface accepts initialState
 * - YAML serialization round-trips initialState as a top-level `state:` block
 * - StateManager.initialize() populates state from initial values
 * - WorkflowExecutor passes workflow.initialState to StateManager on execute
 */

import { Workflow, NodeType } from '../src/models/workflow';
import { workflowToYaml, yamlToWorkflow } from '../src/utils/yamlSerializer';
import { StateManager } from '../src/runtime/stateManager';
import { WorkflowExecutor } from '../src/runtime/workflowExecutor';
import { InMemoryExecutionObserver } from '../src/runtime/executionObserver.interface';
import { CopilotSubagentExecutionContext } from '../src/runtime/executionContext';

// ---- Helpers ----

function createSimpleWorkflow(initialState?: Record<string, unknown>): Workflow {
    return {
        name: 'test-workflow',
        initialState,
        nodes: [
            { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'end' },
        ],
    };
}

// ---- Workflow Model Tests ----

describe('Workflow initialState', () => {
    it('should allow a workflow without initialState', () => {
        const wf: Workflow = {
            name: 'no-state',
            nodes: [],
            edges: [],
        };
        expect(wf.initialState).toBeUndefined();
    });

    it('should allow a workflow with initialState', () => {
        const wf: Workflow = {
            name: 'with-state',
            initialState: { counter: 0, mode: 'draft' },
            nodes: [],
            edges: [],
        };
        expect(wf.initialState).toEqual({ counter: 0, mode: 'draft' });
    });
});

// ---- YAML Serialization Tests ----

describe('YAML initialState serialization', () => {
    it('should omit state block when initialState is undefined', () => {
        const wf = createSimpleWorkflow();
        const yamlStr = workflowToYaml(wf);
        expect(yamlStr).not.toContain('state:');
    });

    it('should serialize initialState as a top-level state block', () => {
        const wf = createSimpleWorkflow({ counter: 0, mode: 'draft' });
        const yamlStr = workflowToYaml(wf);
        expect(yamlStr).toContain('state:');
        expect(yamlStr).toContain('counter: 0');
        expect(yamlStr).toContain('mode: draft');
    });

    it('should round-trip initialState through YAML', () => {
        const initialState = { counter: 42, enabled: true, tags: ['a', 'b'] };
        const wf = createSimpleWorkflow(initialState);
        const yamlStr = workflowToYaml(wf);
        const restored = yamlToWorkflow(yamlStr);
        expect(restored.initialState).toEqual(initialState);
    });

    it('should deserialize a state block from YAML', () => {
        const yamlStr = `
name: imported
state:
  user: alice
  score: 10
nodes:
  - id: start
    type: start
    position: { x: 0, y: 0 }
  - id: end
    type: end
    position: { x: 200, y: 0 }
    data: { summary: false }
edges:
  - source: start
    target: end
`;
        const wf = yamlToWorkflow(yamlStr);
        expect(wf.initialState).toEqual({ user: 'alice', score: 10 });
    });

    it('should produce undefined initialState when YAML has no state block', () => {
        const yamlStr = `
name: no-state
nodes:
  - id: start
    type: start
    position: { x: 0, y: 0 }
edges: []
`;
        const wf = yamlToWorkflow(yamlStr);
        expect(wf.initialState).toBeUndefined();
    });
});

// ---- StateManager Tests ----

describe('StateManager initialize with initialState', () => {
    it('should clear state when initialize called without arguments', () => {
        const sm = new StateManager();
        sm.set('key', 'value');
        sm.initialize();
        expect(sm.get('key')).toBeUndefined();
    });

    it('should populate state from initialState when provided', () => {
        const sm = new StateManager();
        sm.initialize({ counter: 0, mode: 'draft' });
        expect(sm.get('counter')).toBe(0);
        expect(sm.get('mode')).toBe('draft');
    });

    it('should deep-copy initialState so mutations do not affect original', () => {
        const original = { items: [1, 2, 3] };
        const sm = new StateManager();
        sm.initialize(original);
        const items = sm.get('items') as number[];
        items.push(4);
        expect((sm.get('items') as number[]).length).toBe(4);
        expect(original.items.length).toBe(3);
    });
});

// ---- WorkflowExecutor Tests ----

describe('WorkflowExecutor passes initialState to StateManager', () => {
    function createMockCopilotContext(): CopilotSubagentExecutionContext {
        return {
            cancellationToken: {
                onCancellationRequested: () => ({ dispose: () => {} }),
            },
        } as any;
    }

    it('should initialize state with workflow.initialState on execute', async () => {
        const observer = new InMemoryExecutionObserver();
        const executor = new WorkflowExecutor(observer);
        const wf = createSimpleWorkflow({ greeting: 'hello', count: 5 });

        // We can't easily run a full execution without agent invoker,
        // but we can verify the state is set by running a simple workflow
        // that has a delay node to give us a chance to inspect state.
        // Instead, use getStateManager after run() completes.
        const wfWithDelay = {
            ...wf,
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'delay', type: NodeType.Delay, position: { x: 100, y: 0 }, data: { duration: 0 } },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'delay' },
                { id: 'e2', source: 'delay', target: 'end' },
            ],
        };

        const result = await executor.run({
            workflow: wfWithDelay,
            executionContext: createMockCopilotContext(),
            workspaceRoot: '/tmp',
        });

        expect(result).toBeDefined();
        const ctx = executor.getExecutionContext();
        expect(ctx.state['greeting']).toBe('hello');
        expect(ctx.state['count']).toBe(5);
    });

    it('should not set initial state keys when workflow has no initialState', async () => {
        const observer = new InMemoryExecutionObserver();
        const executor = new WorkflowExecutor(observer);
        const wf = {
            name: 'no-initial',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: { summary: false } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        await executor.run({
            workflow: wf,
            executionContext: createMockCopilotContext(),
            workspaceRoot: '/tmp',
        });

        const ctx = executor.getExecutionContext();
        expect(ctx.state['greeting']).toBeUndefined();
        expect(ctx.state['count']).toBeUndefined();
    });
});
