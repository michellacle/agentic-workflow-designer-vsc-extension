/**
 * Tests for the "description" property on Agent, Condition, HumanApproval, and Delay nodes.
 *
 * Covers:
 * - YAML serializer round-trips description for all four node types
 * - Webview properties panel includes a description field for each node type
 * - Webview updateNodeProperty keyMap includes 'Description' mapping
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    Workflow, NodeType,
    AgentNodeData, ConditionNodeData,
    HumanApprovalNodeData, DelayNodeData
} from '../src/models/workflow';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

// ===== YAML Serializer Round-Trip Tests =====

describe('YAML serializer: description field round-trip', () => {
    let workflowToYaml: (wf: Workflow) => string;
    let yamlToWorkflow: (yaml: string) => Workflow;

    beforeAll(async () => {
        const mod = await import('../src/utils/yamlSerializer');
        workflowToYaml = mod.workflowToYaml;
        yamlToWorkflow = mod.yamlToWorkflow;
    });

    it('should preserve description on Agent nodes', () => {
        const workflow: Workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'agent1',
                    type: NodeType.Agent,
                    position: { x: 100, y: 0 },
                    data: {
                        agent: './test.agent.md',
                        prompt: 'do something',
                        description: 'This agent does something important',
                    } as AgentNodeData,
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'agent1' },
                { id: 'e2', source: 'agent1', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        expect(yaml).toContain('description: This agent does something important');

        const restored = yamlToWorkflow(yaml);
        const agentNode = restored.nodes.find(n => n.id === 'agent1');
        expect(agentNode).toBeDefined();
        expect((agentNode!.data as AgentNodeData).description).toBe('This agent does something important');
    });

    it('should preserve description on Condition nodes', () => {
        const workflow: Workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'cond1',
                    type: NodeType.Condition,
                    position: { x: 100, y: 0 },
                    data: {
                        expression: 'state.passed === true',
                        description: 'Check if tests passed',
                    } as ConditionNodeData,
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'cond1' },
                { id: 'e2', source: 'cond1', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        expect(yaml).toContain('description: Check if tests passed');

        const restored = yamlToWorkflow(yaml);
        const condNode = restored.nodes.find(n => n.id === 'cond1');
        expect(condNode).toBeDefined();
        expect((condNode!.data as ConditionNodeData).description).toBe('Check if tests passed');
    });

    it('should preserve description on HumanApproval nodes', () => {
        const workflow: Workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'approval1',
                    type: NodeType.HumanApproval,
                    position: { x: 100, y: 0 },
                    data: {
                        message: 'Approve this change?',
                        description: 'Requires human sign-off before deployment',
                    } as HumanApprovalNodeData,
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'approval1' },
                { id: 'e2', source: 'approval1', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        expect(yaml).toContain('description: Requires human sign-off before deployment');

        const restored = yamlToWorkflow(yaml);
        const approvalNode = restored.nodes.find(n => n.id === 'approval1');
        expect(approvalNode).toBeDefined();
        expect((approvalNode!.data as HumanApprovalNodeData).description).toBe('Requires human sign-off before deployment');
    });

    it('should preserve description on Delay nodes', () => {
        const workflow: Workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'delay1',
                    type: NodeType.Delay,
                    position: { x: 100, y: 0 },
                    data: {
                        duration: 30,
                        description: 'Wait for external service to catch up',
                    } as DelayNodeData,
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'delay1' },
                { id: 'e2', source: 'delay1', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        expect(yaml).toContain('description: Wait for external service to catch up');

        const restored = yamlToWorkflow(yaml);
        const delayNode = restored.nodes.find(n => n.id === 'delay1');
        expect(delayNode).toBeDefined();
        expect((delayNode!.data as DelayNodeData).description).toBe('Wait for external service to catch up');
    });

    it('should handle undefined description gracefully', () => {
        const workflow: Workflow = {
            name: 'test',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'agent1',
                    type: NodeType.Agent,
                    position: { x: 100, y: 0 },
                    data: {
                        agent: './test.agent.md',
                        prompt: 'do something',
                    } as AgentNodeData,
                },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'agent1' },
                { id: 'e2', source: 'agent1', target: 'end' },
            ],
        };

        const yaml = workflowToYaml(workflow);
        const restored = yamlToWorkflow(yaml);
        const agentNode = restored.nodes.find(n => n.id === 'agent1');
        expect(agentNode).toBeDefined();
        // description should be undefined (not an error)
        expect((agentNode!.data as AgentNodeData).description).toBeUndefined();
    });
});

// ===== Webview Properties Panel Tests =====

describe('Webview: description field in properties panel', () => {
    let designerTs: string;

    beforeAll(() => {
        designerTs = readFile('webview/src/designer.ts');
    });

    describe('updatePropertiesPanel includes description input', () => {
        it('should include a description field for Agent nodes', () => {
            // The agent case in updatePropertiesPanel should reference 'Description'
            expect(designerTs).toMatch(/case\s+'agent':[\s\S]*?propertyField\(\s*['"]Description['"]/);
        });

        it('should include a description field for Condition nodes', () => {
            expect(designerTs).toMatch(/case\s+'condition':[\s\S]*?propertyField\(\s*['"]Description['"]/);
        });

        it('should include a description field for Human Approval nodes', () => {
            expect(designerTs).toMatch(/case\s+'human_approval':[\s\S]*?propertyField\(\s*['"]Description['"]/);
        });

        it('should include a description field for Delay nodes', () => {
            expect(designerTs).toMatch(/case\s+'delay':[\s\S]*?propertyField\(\s*['"]Description['"]/);
        });
    });

    describe('updateNodeProperty keyMap includes Description', () => {
        it('should map "Description" label to "description" key', () => {
            expect(designerTs).toMatch(/['"]Description['"]\s*:\s*['"]description['"]/);
        });
    });
});
