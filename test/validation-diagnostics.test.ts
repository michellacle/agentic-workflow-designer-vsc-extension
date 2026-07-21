/**
 * Tests for publishing validation errors to VS Code Problems panel.
 *
 * Covers:
 * - workflowValidator produces structured errors mappable to diagnostics
 * - Diagnostic severity mapping (error -> Error, warning -> Warning)
 * - Validation errors include node/edge identifiers for location mapping
 */

import { Workflow, NodeType } from '../src/models/workflow';
import { validateWorkflow, ValidationError } from '../src/utils/workflowValidator';

// ---- Validator output structure tests ----

describe('Validation error structure', () => {
    it('should return errors for workflow missing Start node', () => {
        const workflow: Workflow = {
            name: 'no-start',
            nodes: [
                { id: 'end', type: NodeType.End, position: { x: 100, y: 100 }, data: {} },
            ],
            edges: [],
        };

        const errors = validateWorkflow(workflow);
        const startErrors = errors.filter(e => e.message.includes('Start'));
        expect(startErrors.length).toBeGreaterThan(0);
        expect(startErrors[0].severity).toBe('error');
    });

    it('should return errors for edge referencing non-existent node', () => {
        const workflow: Workflow = {
            name: 'bad-edge',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ghost' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const edgeErrors = errors.filter(e => e.edge === 'e1');
        expect(edgeErrors.length).toBeGreaterThan(0);
        expect(edgeErrors[0].severity).toBe('error');
        expect(edgeErrors[0].message).toContain('ghost');
    });

    it('should return warnings for orphan nodes', () => {
        const workflow: Workflow = {
            name: 'orphan',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
                { id: 'lonely', type: NodeType.Agent, position: { x: 100, y: 100 }, data: { agent: './test.agent.md' } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const orphanWarnings = errors.filter(e => e.node === 'lonely' && e.severity === 'warning');
        expect(orphanWarnings.length).toBeGreaterThan(0);
    });

    it('should return errors for Agent node without agent configured', () => {
        const workflow: Workflow = {
            name: 'bad-agent',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'agent', type: NodeType.Agent, position: { x: 100, y: 0 }, data: {} },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'agent' },
                { id: 'e2', source: 'agent', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const agentErrors = errors.filter(e => e.node === 'agent' && e.severity === 'error');
        expect(agentErrors.length).toBeGreaterThan(0);
        expect(agentErrors[0].message).toContain('agent');
    });

    it('should return errors for Condition node without expression', () => {
        const workflow: Workflow = {
            name: 'bad-condition',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'cond', type: NodeType.Condition, position: { x: 100, y: 0 }, data: {} },
                { id: 'trueNode', type: NodeType.End, position: { x: 200, y: -50 }, data: {} },
                { id: 'falseNode', type: NodeType.End, position: { x: 200, y: 50 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'cond' },
                { id: 'e2', source: 'cond', target: 'trueNode', label: 'True' },
                { id: 'e3', source: 'cond', target: 'falseNode', label: 'False' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const condErrors = errors.filter(e => e.node === 'cond' && e.severity === 'error');
        expect(condErrors.length).toBeGreaterThan(0);
    });

    it('should return no errors for a valid minimal workflow', () => {
        const workflow: Workflow = {
            name: 'valid',
            nodes: [
                { id: 'start', type: NodeType.Start, position: { x: 0, y: 0 }, data: {} },
                { id: 'end', type: NodeType.End, position: { x: 200, y: 0 }, data: {} },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'end' },
            ],
        };

        const errors = validateWorkflow(workflow);
        const fatalErrors = errors.filter(e => e.severity === 'error');
        expect(fatalErrors.length).toBe(0);
    });

    it('should return ValidationError objects with expected shape', () => {
        const workflow: Workflow = {
            name: 'shape-test',
            nodes: [],
            edges: [],
        };

        const errors = validateWorkflow(workflow);
        expect(errors.length).toBeGreaterThan(0);

        const first = errors[0];
        expect(typeof first.message).toBe('string');
        expect(first.severity).toMatch(/^error|warning$/);
        // node and edge are optional
        expect(first.node === undefined || typeof first.node === 'string').toBe(true);
        expect(first.edge === undefined || typeof first.edge === 'string').toBe(true);
    });
});
