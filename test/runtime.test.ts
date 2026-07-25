/**
 * Tests for the workflow runtime to ensure core functionality remains intact
 * after removing the execution log event emitter.
 */

import {
    Workflow, Node, Edge, NodeType,
    ExecutionStatus, NodeStatus,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData
} from '../src/models/workflow';

// ===== Workflow Model Tests =====

describe('Workflow Model', () => {
    it('should have all expected node types', () => {
        expect(NodeType.Start).toBe('start');
        expect(NodeType.End).toBe('end');
        expect(NodeType.Agent).toBe('agent');
        expect(NodeType.Condition).toBe('condition');
        expect(NodeType.HumanApproval).toBe('human_approval');
        expect(NodeType.Delay).toBe('delay');
    });

    it('should create a valid workflow structure', () => {
        const workflow: Workflow = {
            name: 'test-workflow',
            nodes: [
                {
                    id: 'start_1',
                    type: NodeType.Start,
                    position: { x: 100, y: 100 },
                    data: { label: 'Start' }
                },
                {
                    id: 'end_1',
                    type: NodeType.End,
                    position: { x: 300, y: 100 },
                    data: { label: 'End' }
                }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'end_1' }
            ]
        };

        expect(workflow.nodes.length).toBe(2);
        expect(workflow.edges.length).toBe(1);
        expect(workflow.nodes[0].type).toBe(NodeType.Start);
        expect(workflow.nodes[1].type).toBe(NodeType.End);
    });
});

// ===== StateManager Tests =====

describe('StateManager', () => {
    let StateManager: any;

    beforeAll(async () => {
        const mod = await import('../src/runtime/stateManager');
        StateManager = mod.StateManager;
    });

    it('should initialize with Idle status', () => {
        const sm = new StateManager();
        expect(sm.getStatus()).toBe(ExecutionStatus.Idle);
    });

    it('should set and get state values', () => {
        const sm = new StateManager();
        sm.set('key1', 'value1');
        expect(sm.get('key1')).toBe('value1');
    });

    it('should update execution status', () => {
        const sm = new StateManager();
        sm.setStatus(ExecutionStatus.Running);
        expect(sm.getStatus()).toBe(ExecutionStatus.Running);
    });

    it('should create and retrieve node records via processNode', async () => {
        const sm = new StateManager();
        await sm.processNode('node1', 'Test Node', async () => 'result');
        const record = sm.getNodeRecord('node1');
        expect(record).toBeDefined();
        expect(record!.nodeId).toBe('node1');
        expect(record!.status).toBe(NodeStatus.Completed);
    });

    it('should track node timing via processNode', async () => {
        const sm = new StateManager();
        await sm.processNode('node1', 'Test Node', async () => {
            // Simulate some work
            await new Promise(r => setTimeout(r, 10));
        });
        const record = sm.getNodeRecord('node1')!;
        expect(record.status).toBe(NodeStatus.Completed);
        expect(record.startTime).toBeDefined();
        expect(record.endTime).toBeDefined();
        expect(record.duration!).toBeGreaterThanOrEqual(1);
    });

    it('should mark node as failed when callback throws', async () => {
        const sm = new StateManager();
        await expect(sm.processNode('node1', 'Test Node', async () => {
            throw new Error('test error');
        })).rejects.toThrow('test error');

        const record = sm.getNodeRecord('node1')!;
        expect(record.status).toBe(NodeStatus.Failed);
        expect(record.errors).toContain('Error: test error');
    });

    it('should add logs to node records', async () => {
        const sm = new StateManager();
        await sm.processNode('node1', 'Test Node', async () => {
            sm.addLog('node1', 'test log message');
        });
        const record = sm.getNodeRecord('node1')!;
        expect(record.logs).toContain('test log message');
    });

    it('should add errors to node records', async () => {
        const sm = new StateManager();
        await sm.processNode('node1', 'Test Node', async () => {
            sm.addError('node1', 'test error');
        });
        const record = sm.getNodeRecord('node1')!;
        expect(record.errors).toContain('test error');
    });

    it('should track iteration counts', () => {
        const sm = new StateManager();
        expect(sm.getCurrentIteration('loop1')).toBe(0);
        expect(sm.getIterationCount('loop1')).toBe(1);
        expect(sm.getCurrentIteration('loop1')).toBe(1);
        expect(sm.getIterationCount('loop1')).toBe(2);
    });

    it('should create state snapshots', () => {
        const sm = new StateManager();
        sm.set('key1', 'value1');
        const snapshot = sm.snapshot();
        expect(snapshot.key1).toBe('value1');
    });

    it('should restore state from snapshots', () => {
        const sm = new StateManager();
        sm.set('key1', 'value1');
        const snapshot = sm.snapshot();
        sm.set('key1', 'modified');
        expect(sm.get('key1')).toBe('modified');
        sm.restore(snapshot);
        expect(sm.get('key1')).toBe('value1');
    });

    it('should initialize a new execution context', () => {
        const sm = new StateManager();
        sm.set('key1', 'value1');
        sm.initialize();
        expect(sm.getStatus()).toBe(ExecutionStatus.Running);
        expect(sm.get('key1')).toBeUndefined();
    });

    it('should complete execution with status', () => {
        const sm = new StateManager();
        sm.initialize();
        sm.complete(ExecutionStatus.Completed);
        expect(sm.getStatus()).toBe(ExecutionStatus.Completed);
        expect(sm.context.endTime).toBeDefined();
    });
});

// ===== ConditionEvaluator Tests =====

describe('ConditionEvaluator', () => {
    let ConditionEvaluator: any;

    beforeAll(async () => {
        const mod = await import('../src/runtime/conditionEvaluator');
        ConditionEvaluator = mod.ConditionEvaluator;
    });

    it('should evaluate simple equality', () => {
        const result = ConditionEvaluator.evaluate('state.value === 42', { value: 42 });
        expect(result).toBe(true);
    });

    it('should evaluate inequality', () => {
        const result = ConditionEvaluator.evaluate('state.value !== 42', { value: 10 });
        expect(result).toBe(true);
    });

    it('should evaluate comparison operators', () => {
        expect(ConditionEvaluator.evaluate('state.value > 10', { value: 20 })).toBe(true);
        expect(ConditionEvaluator.evaluate('state.value < 10', { value: 5 })).toBe(true);
        expect(ConditionEvaluator.evaluate('state.value >= 10', { value: 10 })).toBe(true);
        expect(ConditionEvaluator.evaluate('state.value <= 10', { value: 10 })).toBe(true);
    });

    it('should evaluate boolean logic', () => {
        const state = { a: true, b: false };
        expect(ConditionEvaluator.evaluate('state.a && state.b', state)).toBe(false);
        expect(ConditionEvaluator.evaluate('state.a || state.b', state)).toBe(true);
        expect(ConditionEvaluator.evaluate('!state.b', state)).toBe(true);
    });

    it('should handle string comparisons', () => {
        const result = ConditionEvaluator.evaluate("state.name === 'test'", { name: 'test' });
        expect(result).toBe(true);
    });

    it('should return false on evaluation error', () => {
        const result = ConditionEvaluator.evaluate('state.undefinedVar === true', {});
        expect(result).toBe(false);
    });

    it('should validate safe expressions', () => {
        const result = ConditionEvaluator.validateExpression('state.value === true');
        expect(result.valid).toBe(true);
    });

    it('should reject dangerous expressions', () => {
        const result = ConditionEvaluator.validateExpression('eval("malicious")');
        expect(result.valid).toBe(false);
    });

    it('should reject expressions with require', () => {
        const result = ConditionEvaluator.validateExpression('require("fs")');
        expect(result.valid).toBe(false);
    });

    it('should reject expressions with process access', () => {
        const result = ConditionEvaluator.validateExpression('process.exit(1)');
        expect(result.valid).toBe(false);
    });
});

// ===== WorkflowValidator Tests =====

describe('WorkflowValidator', () => {
    let validateWorkflow: any;

    beforeAll(async () => {
        const mod = await import('../src/utils/workflowValidator');
        validateWorkflow = mod.validateWorkflow;
    });

    it('should pass validation for a valid workflow', () => {
        const workflow: Workflow = {
            name: 'valid',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'agent_1', type: NodeType.Agent, position: { x: 100, y: 0 }, data: { agent: 'test' } as AgentNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const fatalErrors = errors.filter((e: any) => e.severity === 'error');
        expect(fatalErrors.length).toBe(0);
    });

    it('should fail if no Start node', () => {
        const workflow: Workflow = {
            name: 'no-start',
            nodes: [
                { id: 'end_1', type: NodeType.End, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter((e: any) => e.message.includes('Start node'));
        expect(startErrors.length).toBeGreaterThan(0);
    });

    it('should fail if multiple Start nodes', () => {
        const workflow: Workflow = {
            name: 'multi-start',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'start_2', type: NodeType.Start, position: { x: 100, y: 0 }, data: {} },
                { id: 'end_1', type: NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter((e: any) => e.message.includes('Start'));
        expect(startErrors.length).toBeGreaterThan(0);
    });

    it('should error if no End node', () => {
        const workflow: Workflow = {
            name: 'no-end',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const endErrors = errors.filter((e: any) => e.message.includes('End node') && e.severity === 'error');
        expect(endErrors.length).toBeGreaterThan(0);
    });

    it('should fail if edge references non-existent node', () => {
        const workflow: Workflow = {
            name: 'bad-edge',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'nonexistent' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const edgeErrors = errors.filter((e: any) => e.message.includes('does not exist'));
        expect(edgeErrors.length).toBeGreaterThan(0);
    });

    it('should fail if edge connects node to itself', () => {
        const workflow: Workflow = {
            name: 'self-edge',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'start_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const selfErrors = errors.filter((e: any) => e.message.includes('itself'));
        expect(selfErrors.length).toBeGreaterThan(0);
    });

    it('should fail if Agent node has no agent configured', () => {
        const workflow: Workflow = {
            name: 'bad-agent',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'agent_1', type: NodeType.Agent, position: { x: 100, y: 0 }, data: { agent: '' } as AgentNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const agentErrors = errors.filter((e: any) => e.message.includes('agent configured'));
        expect(agentErrors.length).toBeGreaterThan(0);
    });

    it('should fail if Condition node has no prompt', () => {
        const workflow: Workflow = {
            name: 'bad-condition',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'cond_1', type: NodeType.Condition, position: { x: 100, y: 0 }, data: { prompt: '' } as ConditionNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'cond_1' },
                { id: 'e2', source: 'cond_1', target: 'end_1', label: 'True' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const condErrors = errors.filter((e: any) => e.message.includes('prompt'));
        expect(condErrors.length).toBeGreaterThan(0);
    });

    it('should fail if Condition node does not have exactly 2 outgoing edges', () => {
        const workflow: Workflow = {
            name: 'bad-condition-edges',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'cond_1', type: NodeType.Condition, position: { x: 100, y: 0 }, data: { prompt: 'Route decision' } as ConditionNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'cond_1' },
                { id: 'e2', source: 'cond_1', target: 'end_1', label: 'True' }
                // Missing False edge
            ]
        };
        const errors = validateWorkflow(workflow);
        const condErrors = errors.filter((e: any) => e.message.includes('2 outgoing edges'));
        expect(condErrors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate node IDs', () => {
        const workflow: Workflow = {
            name: 'duplicate-ids',
            nodes: [
                { id: 'node_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'node_1', type: NodeType.End, position: { x: 100, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const dupErrors = errors.filter((e: any) => e.message.includes('Duplicate'));
        expect(dupErrors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate edges', () => {
        const workflow: Workflow = {
            name: 'duplicate-edges',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'end_1', type: NodeType.End, position: { x: 100, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'end_1' },
                { id: 'e2', source: 'start_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const dupErrors = errors.filter((e: any) => e.message.includes('Duplicate edges'));
        expect(dupErrors.length).toBeGreaterThan(0);
    });
});

// ===== YAML Serializer Tests =====

describe('YAML Serializer', () => {
    let workflowToYaml: any;
    let yamlToWorkflow: any;

    beforeAll(async () => {
        const mod = await import('../src/utils/yamlSerializer');
        workflowToYaml = mod.workflowToYaml;
        yamlToWorkflow = mod.yamlToWorkflow;
    });

    it('should serialize a workflow to YAML', () => {
        const workflow: Workflow = {
            name: 'test-workflow',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 100, y: 50 }, data: { label: 'Start' } },
                { id: 'agent_1', type: NodeType.Agent, position: { x: 300, y: 50 }, data: { agent: 'planner', prompt: 'test', model: 'gpt-4o', timeout: 120, retries: 0 } as AgentNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 500, y: 50 }, data: { label: 'End' } }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'end_1' }
            ]
        };
        const yaml = workflowToYaml(workflow);
        expect(yaml).toContain('name: test-workflow');
        expect(yaml).toContain('id: start_1');
        expect(yaml).toContain('type: start');
        expect(yaml).toContain('agent: planner');
    });

    it('should deserialize a YAML string to a workflow', () => {
        const yamlStr = `
name: test-workflow
nodes:
  - id: start_1
    type: start
    position:
      x: 100
      y: 50
    data:
      label: Start
  - id: end_1
    type: end
    position:
      x: 300
      y: 50
    data:
      label: End
edges:
  - source: start_1
    target: end_1
`;
        const workflow = yamlToWorkflow(yamlStr);
        expect(workflow.name).toBe('test-workflow');
        expect(workflow.nodes.length).toBe(2);
        expect(workflow.edges.length).toBe(1);
    });

    it('should round-trip a workflow through YAML', () => {
        const original: Workflow = {
            name: 'round-trip',
            description: 'A test workflow',
            nodes: [
                { id: 'start_1', type: NodeType.Start, position: { x: 100, y: 50 }, data: { label: 'Start' } },
                { id: 'agent_1', type: NodeType.Agent, position: { x: 300, y: 50 }, data: { agent: 'planner', prompt: 'do stuff', model: 'gpt-4o', timeout: 120, retries: 1 } as AgentNodeData },
                { id: 'cond_1', type: NodeType.Condition, position: { x: 500, y: 50 }, data: { prompt: 'Check result' } as ConditionNodeData },
                { id: 'end_1', type: NodeType.End, position: { x: 700, y: 50 }, data: { label: 'End' } }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'cond_1' },
                { id: 'e3', source: 'cond_1', target: 'end_1', label: 'True' }
            ]
        };
        const yaml = workflowToYaml(original);
        const restored = yamlToWorkflow(yaml);
        expect(restored.name).toBe(original.name);
        expect(restored.nodes.length).toBe(original.nodes.length);
        expect(restored.edges.length).toBe(original.edges.length);
    });
});
