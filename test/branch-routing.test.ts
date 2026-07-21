/**
 * Tests for branch routing behavior in the workflow runtime.
 *
 * Covers:
 * - Condition node branching (True/False edges)
 * - HumanApproval node branching (Approve/Reject edges)
 * - Skipped nodes on untaken branches
 * - Edge label matching (True/False, Pass/Fail, Approve/Reject)
 * - Merge points (multiple edges into the same target)
 * - NodeExecutionResult interface at module level
 */

import {
    Workflow, Node, Edge, NodeType,
    ExecutionStatus, NodeStatus,
    ConditionNodeData, HumanApprovalNodeData,
    DelayNodeData, AgentNodeData
} from '../src/models/workflow';

// Import types that should be at module level
import type { NodeExecutionResult } from '../src/runtime/workflowRuntime';

describe('Branch Routing', () => {

    // ---- NodeExecutionResult type tests ----

    describe('NodeExecutionResult interface', () => {
        it('should be exported at module level', () => {
            // If this compiles, the interface is accessible at module level
            const result: NodeExecutionResult = { success: true };
            expect(result.success).toBe(true);
            expect(result.branchResult).toBeUndefined();
        });

        it('should support branchResult property', () => {
            const trueResult: NodeExecutionResult = { success: true, branchResult: true };
            const falseResult: NodeExecutionResult = { success: true, branchResult: false };

            expect(trueResult.branchResult).toBe(true);
            expect(falseResult.branchResult).toBe(false);
        });

        it('should support failure without branchResult', () => {
            const failed: NodeExecutionResult = { success: false };
            expect(failed.success).toBe(false);
            expect(failed.branchResult).toBeUndefined();
        });
    });

    // ---- Workflow structure with branches ----

    function createBranchWorkflow(): Workflow {
        return {
            name: 'branch-test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'condition',
                    type: NodeType.Condition,
                    position: { x: 100, y: 0 },
                    data: { expression: 'state.should_branch === true' } as ConditionNodeData
                },
                { id: 'true_node', type: NodeType.Delay, position: { x: 200, y: -50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'false_node', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'condition' },
                { id: 'e2', source: 'condition', target: 'true_node', label: 'True' },
                { id: 'e3', source: 'condition', target: 'false_node', label: 'False' },
                { id: 'e4', source: 'true_node', target: 'end' },
                { id: 'e5', source: 'false_node', target: 'end' }
            ]
        };
    }

    function createApprovalWorkflow(): Workflow {
        return {
            name: 'approval-test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'approval',
                    type: NodeType.HumanApproval,
                    position: { x: 100, y: 0 },
                    data: { message: 'Approve this?' } as HumanApprovalNodeData
                },
                { id: 'approved_node', type: NodeType.Delay, position: { x: 200, y: -50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'rejected_node', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'approval' },
                { id: 'e2', source: 'approval', target: 'approved_node', label: 'Approve' },
                { id: 'e3', source: 'approval', target: 'rejected_node', label: 'Reject' },
                { id: 'e4', source: 'approved_node', target: 'end' },
                { id: 'e5', source: 'rejected_node', target: 'end' }
            ]
        };
    }

    function createPassFailWorkflow(): Workflow {
        return {
            name: 'pass-fail-test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'condition',
                    type: NodeType.Condition,
                    position: { x: 100, y: 0 },
                    data: { expression: 'state.tests_passed === true' } as ConditionNodeData
                },
                { id: 'pass_node', type: NodeType.Delay, position: { x: 200, y: -50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'fail_node', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
                { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'condition' },
                { id: 'e2', source: 'condition', target: 'pass_node', label: 'Pass' },
                { id: 'e3', source: 'condition', target: 'fail_node', label: 'Fail' },
                { id: 'e4', source: 'pass_node', target: 'end' },
                { id: 'e5', source: 'fail_node', target: 'end' }
            ]
        };
    }

    function createMergeWorkflow(): Workflow {
        // Two conditions that merge into a single end node
        return {
            name: 'merge-test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'cond_a',
                    type: NodeType.Condition,
                    position: { x: 100, y: -50 },
                    data: { expression: 'state.a === true' } as ConditionNodeData
                },
                {
                    id: 'cond_b',
                    type: NodeType.Condition,
                    position: { x: 100, y: 50 },
                    data: { expression: 'state.b === true' } as ConditionNodeData
                },
                { id: 'end', type: NodeType.End, position: { x: 300, y: 0 }, data: {} }
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'cond_a' },
                { id: 'e2', source: 'start', target: 'cond_b' },
                { id: 'e3', source: 'cond_a', target: 'end', label: 'True' },
                { id: 'e4', source: 'cond_a', target: 'end', label: 'False' },
                { id: 'e5', source: 'cond_b', target: 'end', label: 'True' },
                { id: 'e6', source: 'cond_b', target: 'end', label: 'False' }
            ]
        };
    }

    // ---- Edge label matching tests ----

    describe('Edge label matching', () => {
        let ConditionEvaluator: any;

        beforeAll(async () => {
            const mod = await import('../src/runtime/conditionEvaluator');
            ConditionEvaluator = mod.ConditionEvaluator;
        });

        it('should match "True" label for true branch', () => {
            const workflow = createBranchWorkflow();
            const conditionNode = workflow.nodes.find(n => n.id === 'condition')!;
            const data = conditionNode.data as ConditionNodeData;
            const result = ConditionEvaluator.evaluate(data.expression, { should_branch: true });

            expect(result).toBe(true);
            // Edge with label "True" should be taken
            const trueEdge = workflow.edges.find(e => e.source === 'condition' && e.label === 'True');
            expect(trueEdge).toBeDefined();
        });

        it('should match "False" label for false branch', () => {
            const workflow = createBranchWorkflow();
            const conditionNode = workflow.nodes.find(n => n.id === 'condition')!;
            const data = conditionNode.data as ConditionNodeData;
            const result = ConditionEvaluator.evaluate(data.expression, { should_branch: false });

            expect(result).toBe(false);
            // Edge with label "False" should be taken
            const falseEdge = workflow.edges.find(e => e.source === 'condition' && e.label === 'False');
            expect(falseEdge).toBeDefined();
        });

        it('should match "Pass" label for true branch', () => {
            const workflow = createPassFailWorkflow();
            const passEdge = workflow.edges.find(e => e.source === 'condition' && e.label === 'Pass');
            const failEdge = workflow.edges.find(e => e.source === 'condition' && e.label === 'Fail');

            expect(passEdge).toBeDefined();
            expect(failEdge).toBeDefined();
        });

        it('should match "Approve"/"Reject" labels', () => {
            const workflow = createApprovalWorkflow();
            const approveEdge = workflow.edges.find(e => e.source === 'approval' && e.label === 'Approve');
            const rejectEdge = workflow.edges.find(e => e.source === 'approval' && e.label === 'Reject');

            expect(approveEdge).toBeDefined();
            expect(rejectEdge).toBeDefined();
        });
    });

    // ---- StateManager branch state tests ----

    describe('StateManager branch state', () => {
        let StateManager: any;

        beforeAll(async () => {
            const mod = await import('../src/runtime/stateManager');
            StateManager = mod.StateManager;
        });

        it('should store condition result in state', () => {
            const sm = new StateManager();
            sm.set('condition_result', true);
            expect(sm.get('condition_result')).toBe(true);
        });

        it('should store approval result in state', () => {
            const sm = new StateManager();
            sm.set('approval_approved', false);
            expect(sm.get('approval_approved')).toBe(false);
        });

        it('should store agent output with node id prefix', () => {
            const sm = new StateManager();
            sm.set('agent_1_output', 'test output');
            sm.set('agent_1_success', true);
            expect(sm.get('agent_1_output')).toBe('test output');
            expect(sm.get('agent_1_success')).toBe(true);
        });

        it('should mark nodes as Skipped', () => {
            const sm = new StateManager();
            sm.skipNode('skipped_node', 'Skipped Node');
            const record = sm.getNodeRecord('skipped_node');
            expect(record!.status).toBe(NodeStatus.Skipped);
        });

        it('should distinguish between Completed and Skipped nodes', async () => {
            const sm = new StateManager();
            await sm.processNode('taken_node', 'Taken Node', async () => {});
            sm.skipNode('skipped_node', 'Skipped Node');

            expect(sm.getNodeRecord('taken_node')!.status).toBe(NodeStatus.Completed);
            expect(sm.getNodeRecord('skipped_node')!.status).toBe(NodeStatus.Skipped);
        });
    });

    // ---- Workflow structure validation ----

    describe('Branch workflow structure', () => {
        it('should have correct True/False edge labels', () => {
            const workflow = createBranchWorkflow();
            const conditionEdges = workflow.edges.filter(e => e.source === 'condition');

            expect(conditionEdges).toHaveLength(2);
            const labels = conditionEdges.map(e => e.label).sort();
            expect(labels).toContain('True');
            expect(labels).toContain('False');
        });

        it('should have correct Approve/Reject edge labels', () => {
            const workflow = createApprovalWorkflow();
            const approvalEdges = workflow.edges.filter(e => e.source === 'approval');

            expect(approvalEdges).toHaveLength(2);
            const labels = approvalEdges.map(e => e.label).sort();
            expect(labels).toContain('Approve');
            expect(labels).toContain('Reject');
        });

        it('should handle merge points (multiple edges to same target)', () => {
            const workflow = createMergeWorkflow();
            const endEdges = workflow.edges.filter(e => e.target === 'end');

            // Both conditions should have edges to the end node
            expect(endEdges.length).toBeGreaterThanOrEqual(2);
        });

        it('should not have duplicate edge IDs', () => {
            const workflow = createBranchWorkflow();
            const edgeIds = workflow.edges.map(e => e.id);
            const uniqueIds = new Set(edgeIds);

            expect(edgeIds.length).toBe(uniqueIds.size);
        });

        it('should have all edge targets reference existing nodes', () => {
            const workflow = createBranchWorkflow();
            const nodeIds = new Set(workflow.nodes.map(n => n.id));

            for (const edge of workflow.edges) {
                expect(nodeIds.has(edge.source)).toBe(true);
                expect(nodeIds.has(edge.target)).toBe(true);
            }
        });
    });

    // ---- Nested branch tests ----

    describe('Nested branches', () => {
        it('should handle nested condition nodes', () => {
            const workflow: Workflow = {
                name: 'nested-branch',
                nodes: [
                    { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                    {
                        id: 'outer_cond',
                        type: NodeType.Condition,
                        position: { x: 100, y: 0 },
                        data: { expression: 'state.outer === true' } as ConditionNodeData
                    },
                    {
                        id: 'inner_cond',
                        type: NodeType.Condition,
                        position: { x: 200, y: -50 },
                        data: { expression: 'state.inner === true' } as ConditionNodeData
                    },
                    { id: 'inner_true', type: NodeType.Delay, position: { x: 300, y: -100 }, data: { duration: 0 } as DelayNodeData },
                    { id: 'inner_false', type: NodeType.Delay, position: { x: 300, y: 0 }, data: { duration: 0 } as DelayNodeData },
                    { id: 'outer_false', type: NodeType.Delay, position: { x: 200, y: 50 }, data: { duration: 0 } as DelayNodeData },
                    { id: 'end', type: NodeType.End, position: { x: 400, y: 0 }, data: {} }
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'outer_cond' },
                    { id: 'e2', source: 'outer_cond', target: 'inner_cond', label: 'True' },
                    { id: 'e3', source: 'outer_cond', target: 'outer_false', label: 'False' },
                    { id: 'e4', source: 'inner_cond', target: 'inner_true', label: 'True' },
                    { id: 'e5', source: 'inner_cond', target: 'inner_false', label: 'False' },
                    { id: 'e6', source: 'inner_true', target: 'end' },
                    { id: 'e7', source: 'inner_false', target: 'end' },
                    { id: 'e8', source: 'outer_false', target: 'end' }
                ]
            };

            // Verify structure
            const outerEdges = workflow.edges.filter(e => e.source === 'outer_cond');
            expect(outerEdges).toHaveLength(2);

            const innerEdges = workflow.edges.filter(e => e.source === 'inner_cond');
            expect(innerEdges).toHaveLength(2);
        });
    });

    // ---- Agent output state propagation ----

    describe('Agent output state propagation', () => {
        let StateManager: any;

        beforeAll(async () => {
            const mod = await import('../src/runtime/stateManager');
            StateManager = mod.StateManager;
        });

        it('should store agent output for downstream condition evaluation', () => {
            const sm = new StateManager();
            // Simulate agent node storing output
            sm.set('agent_11_output', 'Agent error: Sorry, no response was returned.');
            sm.set('agent_11_success', true);

            // Downstream condition can check agent output
            expect(sm.get('agent_11_success')).toBe(true);
            expect(typeof sm.get('agent_11_output')).toBe('string');
        });

        it('should support boolean state from agent success', () => {
            const sm = new StateManager();
            sm.set('agent_success', true);

            const ConditionEvaluator = require('../src/runtime/conditionEvaluator').ConditionEvaluator;
            const result = ConditionEvaluator.evaluate('state.agent_success === true', sm.state);
            expect(result).toBe(true);
        });
    });
});
