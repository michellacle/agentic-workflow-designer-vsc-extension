/**
 * Tests for selection box drag feature in the workflow designer.
 *
 * Features tested:
 * 1. Click and drag on empty canvas to create a selection box
 * 2. Nodes whose bounding boxes intersect the selection box become selected
 * 3. Shift+drag adds to existing selection instead of replacing it
 * 4. Selection box is visually rendered as a rectangle
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

function extractFunctionBody(source: string, fnName: string): string | null {
    const fnStart = source.indexOf(`function ${fnName}`);
    if (fnStart < 0) return null;
    const braceStart = source.indexOf('{', fnStart);
    if (braceStart < 0) return null;
    let braceCount = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') braceCount++;
        if (source[i] === '}') braceCount--;
        if (braceCount === 0) return source.substring(braceStart + 1, i);
    }
    return null;
}

// ===== Feature: Selection Box Drag =====

describe('Selection box drag', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    describe('State variables', () => {
        it('should have a selectionBox state variable', () => {
            expect(designerContent).toMatch(/selectionBox/);
        });

        it('should track selection box start and end coordinates', () => {
            // Should have start and end (or x1/y1/x2/y2 or similar) for the box
            expect(designerContent).toMatch(/selectionBox[\s\S]{0,200}(start|x1|from)/i);
        });
    });

    describe('Mouse down - initiating selection box', () => {
        it('should start selection box on mouse down when clicking empty canvas in edit mode', () => {
            const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
            expect(onMouseDownBody).not.toBeNull();
            // Should reference selectionBox in onMouseDown
            expect(onMouseDownBody).toMatch(/selectionBox/);
        });

        it('should distinguish between panning and selection box drag', () => {
            // Should have logic to differentiate panning (middle mouse or no drag) from selection box
            expect(designerContent).toMatch(/selectionBox[\s\S]{0,500}(panning|editMode)/i);
        });
    });

    describe('Mouse move - updating selection box', () => {
        it('should update selection box coordinates on mouse move', () => {
            const onMouseMoveBody = extractFunctionBody(designerContent, 'onMouseMove');
            expect(onMouseMoveBody).not.toBeNull();
            expect(onMouseMoveBody).toMatch(/selectionBox/);
        });

        it('should render while selection box is being dragged', () => {
            const onMouseMoveBody = extractFunctionBody(designerContent, 'onMouseMove');
            expect(onMouseMoveBody).not.toBeNull();
            // Should call render after updating selection box
            expect(onMouseMoveBody).toMatch(/selectionBox[\s\S]{0,300}render|render[\s\S]{0,100}selectionBox/);
        });
    });

    describe('Mouse up - finalizing selection', () => {
        it('should select nodes within the selection box on mouse up', () => {
            const onMouseUpBody = extractFunctionBody(designerContent, 'onMouseUp');
            expect(onMouseUpBody).not.toBeNull();
            // Should reference selectionBox and selectedNodeIds
            expect(onMouseUpBody).toMatch(/selectionBox/);
            expect(onMouseUpBody).toMatch(/selectedNodeIds/);
        });

        it('should clear selection box state after mouse up', () => {
            const onMouseUpBody = extractFunctionBody(designerContent, 'onMouseUp');
            expect(onMouseUpBody).not.toBeNull();
            // Should set selectionBox to null after processing
            expect(onMouseUpBody).toMatch(/selectionBox\s*=\s*null/);
        });
    });

    describe('Node intersection detection', () => {
        it('should have a function to check if a node is within a rectangle', () => {
            // Should have a helper like nodesInRect, intersectRect, or similar
            expect(designerContent).toMatch(/nodesInRect|intersectRect|nodeInRect|rectContains|intersectsRect/i);
        });

        it('should use node position and dimensions for intersection check', () => {
            // The intersection function should reference node position and width/height
            expect(designerContent).toMatch(/nodeInRect|intersectRect|nodesInRect/i);
            const match = designerContent.match(/function\s+(nodesInRect|intersectRect|nodeInRect|rectContains|intersectsRect)\s*\([^)]*\)/i);
            if (match) {
                const fnBody = extractFunctionBody(designerContent, match[1]);
                expect(fnBody).not.toBeNull();
                expect(fnBody).toMatch(/position/);
                expect(fnBody).toMatch(/width|height|config/i);
            }
        });
    });

    describe('Visual rendering', () => {
        it('should draw a selection box rectangle on the canvas', () => {
            // Should have a drawSelectionBox or similar function
            expect(designerContent).toMatch(/drawSelectionBox|draw.*selection.*box|selectionBox.*draw/i);
        });

        it('should render the selection box with a visible border and fill', () => {
            const drawFnMatch = designerContent.match(/function\s+(drawSelectionBox|draw.*Selection.*Box)\s*\(/i);
            if (drawFnMatch) {
                const fnBody = extractFunctionBody(designerContent, drawFnMatch[1]);
                expect(fnBody).not.toBeNull();
                // Should set fillStyle and strokeStyle for the box
                expect(fnBody).toMatch(/fillStyle/);
                expect(fnBody).toMatch(/strokeStyle/);
            }
        });

        it('should call drawSelectionBox from the render function', () => {
            const renderBody = extractFunctionBody(designerContent, 'render');
            expect(renderBody).not.toBeNull();
            expect(renderBody).toMatch(/drawSelectionBox|selectionBox/i);
        });
    });

    describe('Shift+drag behavior', () => {
        it('should support shift key to add to existing selection', () => {
            // Should check shiftKey when processing selection box results
            expect(designerContent).toMatch(/selectionBox[\s\S]{0,500}shiftKey|shiftKey[\s\S]{0,500}selectionBox/i);
        });
    });
});
