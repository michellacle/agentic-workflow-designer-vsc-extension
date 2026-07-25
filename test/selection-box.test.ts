/**
 * Tests for canvas pan behavior (selection box removed).
 *
 * The selection box feature was removed in favor of left-drag panning.
 * Multi-select is available via Shift+Click on individual nodes.
 *
 * Features tested:
 * 1. Selection box code is fully removed (no selectionBox state, no drawSelectionBox, no nodesInRect)
 * 2. Left-drag on empty canvas starts panning in both edit and view modes
 * 3. Middle-mouse drag also starts panning
 * 4. Shift+Click on nodes still works for multi-select
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

// ===== Feature: Selection Box Removed, Canvas Pan Added =====

describe('Selection box removed and canvas pan behavior', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    describe('Selection box code removed', () => {
        it('should NOT have a selectionBox state variable', () => {
            expect(designerContent).not.toMatch(/selectionBox/);
        });

        it('should NOT have nodesInRect function', () => {
            expect(designerContent).not.toMatch(/nodesInRect/);
        });

        it('should NOT have drawSelectionBox function', () => {
            expect(designerContent).not.toMatch(/drawSelectionBox/);
        });
    });

    describe('Mouse down - left-drag on empty canvas starts pan', () => {
        it('should start panning on left-click empty canvas without edit mode gate', () => {
            const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
            expect(onMouseDownBody).not.toBeNull();
            // Should NOT reference selectionBox
            expect(onMouseDownBody).not.toMatch(/selectionBox/);
            // Should start panning on empty canvas
            expect(onMouseDownBody).toMatch(/state\.panning\s*=\s*true/);
        });

        it('should support middle-mouse pan', () => {
            const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
            expect(onMouseDownBody).not.toBeNull();
            expect(onMouseDownBody).toMatch(/e\.button\s*===\s*1/);
        });
    });

    describe('Mouse move - panning updates viewport', () => {
        it('should update viewport on mouse move when panning', () => {
            const onMouseMoveBody = extractFunctionBody(designerContent, 'onMouseMove');
            expect(onMouseMoveBody).not.toBeNull();
            expect(onMouseMoveBody).toMatch(/state\.panning/);
            expect(onMouseMoveBody).toMatch(/viewport\.x/);
            expect(onMouseMoveBody).toMatch(/viewport\.y/);
        });

        it('should NOT update selection box on mouse move', () => {
            const onMouseMoveBody = extractFunctionBody(designerContent, 'onMouseMove');
            expect(onMouseMoveBody).not.toBeNull();
            expect(onMouseMoveBody).not.toMatch(/selectionBox/);
        });
    });

    describe('Mouse up - panning stops', () => {
        it('should clear panning state on mouse up', () => {
            const onMouseUpBody = extractFunctionBody(designerContent, 'onMouseUp');
            expect(onMouseUpBody).not.toBeNull();
            expect(onMouseUpBody).toMatch(/state\.panning\s*=\s*false/);
        });

        it('should NOT finalize selection box on mouse up', () => {
            const onMouseUpBody = extractFunctionBody(designerContent, 'onMouseUp');
            expect(onMouseUpBody).not.toBeNull();
            expect(onMouseUpBody).not.toMatch(/selectionBox/);
        });
    });

    describe('Shift+Click multi-select still works', () => {
        it('should support shift key to toggle node selection', () => {
            const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
            expect(onMouseDownBody).not.toBeNull();
            expect(onMouseDownBody).toMatch(/shiftKey/);
            expect(onMouseDownBody).toMatch(/selectedNodeIds/);
        });
    });
});
