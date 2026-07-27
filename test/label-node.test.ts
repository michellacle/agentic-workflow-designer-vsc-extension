import { NodeType, isAnnotationNode, LabelNodeData } from '../src/models/workflow';

describe('Label Node', () => {
    describe('NodeType enum', () => {
        it('should have a Label type', () => {
            expect(NodeType.Label).toBe('label');
        });
    });

    describe('isAnnotationNode', () => {
        it('should return true for Label type', () => {
            expect(isAnnotationNode(NodeType.Label)).toBe(true);
        });

        it('should return false for executable types', () => {
            expect(isAnnotationNode(NodeType.Start)).toBe(false);
            expect(isAnnotationNode(NodeType.Agent)).toBe(false);
            expect(isAnnotationNode(NodeType.Condition)).toBe(false);
        });
    });

    describe('LabelNodeData', () => {
        it('should accept a text-only data shape', () => {
            const data: LabelNodeData = { text: 'Section Header' };
            expect(data.text).toBe('Section Header');
        });
    });
});
