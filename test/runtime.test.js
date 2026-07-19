"use strict";
/**
 * Tests for the workflow runtime to ensure core functionality remains intact
 * after removing the execution log event emitter.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const workflow_1 = require("../src/models/workflow");
// ===== Workflow Model Tests =====
describe('Workflow Model', () => {
    it('should have all expected node types', () => {
        expect(workflow_1.NodeType.Start).toBe('start');
        expect(workflow_1.NodeType.End).toBe('end');
        expect(workflow_1.NodeType.Agent).toBe('agent');
        expect(workflow_1.NodeType.Condition).toBe('condition');
        expect(workflow_1.NodeType.HumanApproval).toBe('human_approval');
        expect(workflow_1.NodeType.Delay).toBe('delay');
    });
    it('should create a valid workflow structure', () => {
        const workflow = {
            name: 'test-workflow',
            nodes: [
                {
                    id: 'start_1',
                    type: workflow_1.NodeType.Start,
                    position: { x: 100, y: 100 },
                    data: { label: 'Start' }
                },
                {
                    id: 'end_1',
                    type: workflow_1.NodeType.End,
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
        expect(workflow.nodes[0].type).toBe(workflow_1.NodeType.Start);
        expect(workflow.nodes[1].type).toBe(workflow_1.NodeType.End);
    });
});
// ===== StateManager Tests =====
describe('StateManager', () => {
    let StateManager;
    beforeAll(async () => {
        const mod = await Promise.resolve().then(() => __importStar(require('../src/runtime/stateManager')));
        StateManager = mod.StateManager;
    });
    it('should initialize with Idle status', () => {
        const sm = new StateManager();
        expect(sm.getStatus()).toBe(workflow_1.ExecutionStatus.Idle);
    });
    it('should set and get state values', () => {
        const sm = new StateManager();
        sm.set('key1', 'value1');
        expect(sm.get('key1')).toBe('value1');
    });
    it('should update execution status', () => {
        const sm = new StateManager();
        sm.setStatus(workflow_1.ExecutionStatus.Running);
        expect(sm.getStatus()).toBe(workflow_1.ExecutionStatus.Running);
    });
    it('should create and retrieve node records', () => {
        const sm = new StateManager();
        sm.createNodeRecord('node1', workflow_1.NodeStatus.Waiting, 'Test Node');
        const record = sm.getNodeRecord('node1');
        expect(record).toBeDefined();
        expect(record.nodeId).toBe('node1');
        expect(record.status).toBe(workflow_1.NodeStatus.Waiting);
    });
    it('should update node status', () => {
        const sm = new StateManager();
        sm.createNodeRecord('node1', workflow_1.NodeStatus.Waiting);
        sm.updateNodeStatus('node1', workflow_1.NodeStatus.Running);
        expect(sm.getNodeRecord('node1').status).toBe(workflow_1.NodeStatus.Running);
    });
    it('should track node timing', () => {
        const sm = new StateManager();
        sm.createNodeRecord('node1', workflow_1.NodeStatus.Waiting);
        sm.startNode('node1');
        // After start, status should be Running
        expect(sm.getNodeRecord('node1').status).toBe(workflow_1.NodeStatus.Running);
        expect(sm.getNodeRecord('node1').startTime).toBeDefined();
        sm.endNode('node1', workflow_1.NodeStatus.Completed);
        expect(sm.getNodeRecord('node1').status).toBe(workflow_1.NodeStatus.Completed);
        expect(sm.getNodeRecord('node1').endTime).toBeDefined();
        expect(sm.getNodeRecord('node1').duration).toBeGreaterThanOrEqual(0);
    });
    it('should add logs to node records', () => {
        const sm = new StateManager();
        sm.createNodeRecord('node1', workflow_1.NodeStatus.Waiting);
        sm.addLog('node1', 'test log message');
        const record = sm.getNodeRecord('node1');
        expect(record.logs).toContain('test log message');
    });
    it('should add errors to node records', () => {
        const sm = new StateManager();
        sm.createNodeRecord('node1', workflow_1.NodeStatus.Waiting);
        sm.addError('node1', 'test error');
        const record = sm.getNodeRecord('node1');
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
        expect(sm.getStatus()).toBe(workflow_1.ExecutionStatus.Running);
        expect(sm.get('key1')).toBeUndefined();
    });
    it('should complete execution with status', () => {
        const sm = new StateManager();
        sm.initialize();
        sm.complete(workflow_1.ExecutionStatus.Completed);
        expect(sm.getStatus()).toBe(workflow_1.ExecutionStatus.Completed);
        expect(sm.context.endTime).toBeDefined();
    });
});
// ===== ConditionEvaluator Tests =====
describe('ConditionEvaluator', () => {
    let ConditionEvaluator;
    beforeAll(async () => {
        const mod = await Promise.resolve().then(() => __importStar(require('../src/runtime/conditionEvaluator')));
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
    let validateWorkflow;
    beforeAll(async () => {
        const mod = await Promise.resolve().then(() => __importStar(require('../src/utils/workflowValidator')));
        validateWorkflow = mod.validateWorkflow;
    });
    it('should pass validation for a valid workflow', () => {
        const workflow = {
            name: 'valid',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'agent_1', type: workflow_1.NodeType.Agent, position: { x: 100, y: 0 }, data: { agent: 'test' } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const fatalErrors = errors.filter((e) => e.severity === 'error');
        expect(fatalErrors.length).toBe(0);
    });
    it('should fail if no Start node', () => {
        const workflow = {
            name: 'no-start',
            nodes: [
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter((e) => e.message.includes('Start node'));
        expect(startErrors.length).toBeGreaterThan(0);
    });
    it('should fail if multiple Start nodes', () => {
        const workflow = {
            name: 'multi-start',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'start_2', type: workflow_1.NodeType.Start, position: { x: 100, y: 0 }, data: {} },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter((e) => e.message.includes('Start'));
        expect(startErrors.length).toBeGreaterThan(0);
    });
    it('should warn if no End node', () => {
        const workflow = {
            name: 'no-end',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const endWarnings = errors.filter((e) => e.message.includes('End node'));
        expect(endWarnings.length).toBeGreaterThan(0);
    });
    it('should fail if edge references non-existent node', () => {
        const workflow = {
            name: 'bad-edge',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'nonexistent' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const edgeErrors = errors.filter((e) => e.message.includes('does not exist'));
        expect(edgeErrors.length).toBeGreaterThan(0);
    });
    it('should fail if edge connects node to itself', () => {
        const workflow = {
            name: 'self-edge',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'start_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const selfErrors = errors.filter((e) => e.message.includes('itself'));
        expect(selfErrors.length).toBeGreaterThan(0);
    });
    it('should fail if Agent node has no agent configured', () => {
        const workflow = {
            name: 'bad-agent',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'agent_1', type: workflow_1.NodeType.Agent, position: { x: 100, y: 0 }, data: { agent: '' } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'agent_1' },
                { id: 'e2', source: 'agent_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const agentErrors = errors.filter((e) => e.message.includes('agent configured'));
        expect(agentErrors.length).toBeGreaterThan(0);
    });
    it('should fail if Condition node has no expression', () => {
        const workflow = {
            name: 'bad-condition',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'cond_1', type: workflow_1.NodeType.Condition, position: { x: 100, y: 0 }, data: { expression: '' } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'cond_1' },
                { id: 'e2', source: 'cond_1', target: 'end_1', label: 'True' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const condErrors = errors.filter((e) => e.message.includes('expression'));
        expect(condErrors.length).toBeGreaterThan(0);
    });
    it('should fail if Condition node does not have exactly 2 outgoing edges', () => {
        const workflow = {
            name: 'bad-condition-edges',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'cond_1', type: workflow_1.NodeType.Condition, position: { x: 100, y: 0 }, data: { expression: 'true' } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 200, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'cond_1' },
                { id: 'e2', source: 'cond_1', target: 'end_1', label: 'True' }
                // Missing False edge
            ]
        };
        const errors = validateWorkflow(workflow);
        const condErrors = errors.filter((e) => e.message.includes('2 outgoing edges'));
        expect(condErrors.length).toBeGreaterThan(0);
    });
    it('should detect duplicate node IDs', () => {
        const workflow = {
            name: 'duplicate-ids',
            nodes: [
                { id: 'node_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'node_1', type: workflow_1.NodeType.End, position: { x: 100, y: 0 }, data: {} }
            ],
            edges: []
        };
        const errors = validateWorkflow(workflow);
        const dupErrors = errors.filter((e) => e.message.includes('Duplicate'));
        expect(dupErrors.length).toBeGreaterThan(0);
    });
    it('should detect duplicate edges', () => {
        const workflow = {
            name: 'duplicate-edges',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 100, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start_1', target: 'end_1' },
                { id: 'e2', source: 'start_1', target: 'end_1' }
            ]
        };
        const errors = validateWorkflow(workflow);
        const dupErrors = errors.filter((e) => e.message.includes('Duplicate edges'));
        expect(dupErrors.length).toBeGreaterThan(0);
    });
});
// ===== YAML Serializer Tests =====
describe('YAML Serializer', () => {
    let workflowToYaml;
    let yamlToWorkflow;
    beforeAll(async () => {
        const mod = await Promise.resolve().then(() => __importStar(require('../src/utils/yamlSerializer')));
        workflowToYaml = mod.workflowToYaml;
        yamlToWorkflow = mod.yamlToWorkflow;
    });
    it('should serialize a workflow to YAML', () => {
        const workflow = {
            name: 'test-workflow',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 100, y: 50 }, data: { label: 'Start' } },
                { id: 'agent_1', type: workflow_1.NodeType.Agent, position: { x: 300, y: 50 }, data: { agent: 'planner', prompt: 'test', model: 'gpt-4o', timeout: 120, retries: 0 } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 500, y: 50 }, data: { label: 'End' } }
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
        const original = {
            name: 'round-trip',
            description: 'A test workflow',
            nodes: [
                { id: 'start_1', type: workflow_1.NodeType.Start, position: { x: 100, y: 50 }, data: { label: 'Start' } },
                { id: 'agent_1', type: workflow_1.NodeType.Agent, position: { x: 300, y: 50 }, data: { agent: 'planner', prompt: 'do stuff', model: 'gpt-4o', timeout: 120, retries: 1 } },
                { id: 'cond_1', type: workflow_1.NodeType.Condition, position: { x: 500, y: 50 }, data: { expression: 'state.result === true' } },
                { id: 'end_1', type: workflow_1.NodeType.End, position: { x: 700, y: 50 }, data: { label: 'End' } }
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
//# sourceMappingURL=runtime.test.js.map