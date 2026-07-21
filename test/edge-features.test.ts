/**
 * Tests for edge-related webview features in the workflow designer.
 *
 * Features tested:
 * 1. Animate edges to show execution flow using event-driven transitions
 * 2. Select and delete individual connections (edges)
 * 3. Edit connection labels via double-click
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

// ===== Feature 1: Animate edges to show execution flow =====

describe('Feature 1: Animate edges to show execution flow', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    it('should have animationTime state variable', () => {
        expect(designerContent).toMatch(/animationTime:/);
    });

    it('should have animationFrameId state variable', () => {
        expect(designerContent).toMatch(/animationFrameId:/);
    });

    it('should track explicit edge animation state in the webview state object', () => {
        expect(designerContent).toContain('edgeAnimations:');
    });

    it('should track explicit node animation state in the webview state object', () => {
        expect(designerContent).toContain('nodeAnimations:');
        expect(designerContent).toContain('pendingNodePulses:');
    });

    it('should derive execution animations from executionUpdate events', () => {
        expect(designerContent).toContain('updateExecutionAnimations(msg.status)');
        expect(designerContent).toContain('function updateExecutionAnimations');
    });

    it('should not rely on target node running status for edge animation', () => {
        const drawEdgeBody = extractFunctionBody(designerContent, 'drawEdge');
        expect(drawEdgeBody).not.toBeNull();
        expect(drawEdgeBody).not.toContain('isTargetRunning');
    });

    it('should setLineDash for animated dashes when an edge animation is active', () => {
        const drawEdgeBody = extractFunctionBody(designerContent, 'drawEdge');
        expect(drawEdgeBody).not.toBeNull();
        expect(drawEdgeBody).toContain('setLineDash');
        expect(drawEdgeBody).toContain('isEdgeAnimating');
    });

    it('should use lineDashOffset for animation movement', () => {
        const drawEdgeBody = extractFunctionBody(designerContent, 'drawEdge');
        expect(drawEdgeBody).not.toBeNull();
        expect(drawEdgeBody).toContain('lineDashOffset');
        expect(drawEdgeBody).toContain('elapsed');
    });

    it('should have an animate function for requestAnimationFrame loop', () => {
        expect(designerContent).toMatch(/function\s+animate\s*\(/);
    });

    it('should have a startAnimationLoop function', () => {
        expect(designerContent).toMatch(/function\s+startAnimationLoop\s*\(/);
    });

    it('should call startAnimationLoop during initialization', () => {
        expect(designerContent).toContain('startAnimationLoop()');
    });

    it('should increment animationTime in the animate function', () => {
        const animateBody = extractFunctionBody(designerContent, 'animate');
        expect(animateBody).not.toBeNull();
        expect(animateBody).toMatch(/animationTime\s*\+/);
    });

    it('should prune completed animations in the animation loop', () => {
        const animateBody = extractFunctionBody(designerContent, 'animate');
        expect(animateBody).not.toBeNull();
        expect(animateBody).toContain('pruneAnimationState');
    });

    it('should use requestAnimationFrame in the animate function', () => {
        const animateBody = extractFunctionBody(designerContent, 'animate');
        expect(animateBody).not.toBeNull();
        expect(animateBody).toContain('requestAnimationFrame');
    });

    it('should reset lineDash after drawing animated edge', () => {
        const drawEdgeBody = extractFunctionBody(designerContent, 'drawEdge');
        expect(drawEdgeBody).not.toBeNull();
        // Should have at least 2 setLineDash calls (one to set, one to reset)
        const matches = drawEdgeBody!.match(/setLineDash/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

// ===== Feature 2: Select and delete individual connections =====

describe('Feature 2: Select and delete individual connections', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    it('should have selectedEdgeId state variable', () => {
        expect(designerContent).toMatch(/selectedEdgeId:/);
    });

    it('should have hitTestEdges function for edge hit detection', () => {
        expect(designerContent).toMatch(/function\s+hitTestEdges\s*\(/);
    });

    it('should have distanceToCubicBezier function for curve distance calculation', () => {
        expect(designerContent).toMatch(/function\s+distanceToCubicBezier\s*\(/);
    });

    it('should have bezierPoint helper function', () => {
        expect(designerContent).toMatch(/function\s+bezierPoint\s*\(/);
    });

    it('should check for edge hit in onMouseDown when in edit mode', () => {
        const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
        expect(onMouseDownBody).not.toBeNull();
        expect(onMouseDownBody).toContain('hitTestEdges');
        expect(onMouseDownBody).toContain('editMode');
    });

    it('should set selectedEdgeId when an edge is clicked', () => {
        const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
        expect(onMouseDownBody).not.toBeNull();
        expect(onMouseDownBody).toMatch(/selectedEdgeId\s*=/);
    });

    it('should have deleteSelectedEdge function', () => {
        expect(designerContent).toMatch(/function\s+deleteSelectedEdge\s*\(/);
    });

    it('should call deleteSelectedEdge on Delete/Backspace when edge is selected', () => {
        const onKeyDownBody = extractFunctionBody(designerContent, 'onKeyDown');
        expect(onKeyDownBody).not.toBeNull();
        expect(onKeyDownBody).toContain('deleteSelectedEdge');
        expect(onKeyDownBody).toContain('selectedEdgeId');
    });

    it('should highlight selected edges with different style in drawEdge', () => {
        const drawEdgeBody = extractFunctionBody(designerContent, 'drawEdge');
        expect(drawEdgeBody).not.toBeNull();
        expect(drawEdgeBody).toContain('isSelected');
        expect(drawEdgeBody).toContain('selectedEdgeId');
    });

    it('should clear selectedEdgeId when clicking empty canvas', () => {
        const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
        expect(onMouseDownBody).not.toBeNull();
        // Should clear selectedEdgeId when clicking empty canvas
        expect(onMouseDownBody).toMatch(/selectedEdgeId\s*=\s*null/);
    });

    it('should clear selectedEdgeId on Escape key', () => {
        const onKeyDownBody = extractFunctionBody(designerContent, 'onKeyDown');
        expect(onKeyDownBody).not.toBeNull();
        expect(onKeyDownBody).toMatch(/Escape.*selectedEdgeId|selectedEdgeId.*Escape/s);
    });

    it('should have a threshold for edge hit detection', () => {
        const hitTestEdgesBody = extractFunctionBody(designerContent, 'hitTestEdges');
        expect(hitTestEdgesBody).not.toBeNull();
        expect(hitTestEdgesBody).toMatch(/threshold/);
    });

    it('should clear node selection when selecting an edge', () => {
        const onMouseDownBody = extractFunctionBody(designerContent, 'onMouseDown');
        expect(onMouseDownBody).not.toBeNull();
        // When selecting an edge, should clear node selection
        expect(onMouseDownBody).toMatch(/selectedEdgeId.*selectedNodeIds.*clear|selectedNodeIds.*clear.*selectedEdgeId/s);
    });
});

// ===== Feature 3: Edit connection label after creating it =====

describe('Feature 3: Edit connection label after creating it', () => {
    let designerContent: string;
    let providerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
        providerContent = readFile('src/designer/workflowDesignerProvider.ts');
    });

    it('should have a dblclick event listener on canvas', () => {
        expect(designerContent).toMatch(/addEventListener\('dblclick',\s*onDoubleClick/);
    });

    it('should have an onDoubleClick function', () => {
        expect(designerContent).toMatch(/function\s+onDoubleClick\s*\(/);
    });

    it('should call hitTestEdges in onDoubleClick', () => {
        const onDoubleClickBody = extractFunctionBody(designerContent, 'onDoubleClick');
        expect(onDoubleClickBody).not.toBeNull();
        expect(onDoubleClickBody).toContain('hitTestEdges');
    });

    it('should postMessage with type editEdgeLabel on double-click', () => {
        const onDoubleClickBody = extractFunctionBody(designerContent, 'onDoubleClick');
        expect(onDoubleClickBody).not.toBeNull();
        expect(onDoubleClickBody).toContain('editEdgeLabel');
    });

    it('should include edgeId and currentLabel in editEdgeLabel message', () => {
        const onDoubleClickBody = extractFunctionBody(designerContent, 'onDoubleClick');
        expect(onDoubleClickBody).not.toBeNull();
        expect(onDoubleClickBody).toContain('edgeId');
        expect(onDoubleClickBody).toContain('currentLabel');
    });

    it('should guard onDoubleClick behind editMode flag', () => {
        const onDoubleClickBody = extractFunctionBody(designerContent, 'onDoubleClick');
        expect(onDoubleClickBody).not.toBeNull();
        expect(onDoubleClickBody).toMatch(/editMode.*return|return.*editMode/s);
    });

    it('should handle edgeLabelUpdate message in onMessage', () => {
        expect(designerContent).toContain("'edgeLabelUpdate'");
    });

    it('should update edge label from edgeLabelUpdate message', () => {
        const onMessageBody = extractFunctionBody(designerContent, 'onMessage');
        expect(onMessageBody).not.toBeNull();
        expect(onMessageBody).toMatch(/edgeLabelUpdate.*newLabel|newLabel.*edgeLabelUpdate/s);
    });

    it('should call notifyWorkflowUpdate after edge label change', () => {
        const onMessageBody = extractFunctionBody(designerContent, 'onMessage');
        expect(onMessageBody).not.toBeNull();
        // After edgeLabelUpdate case, should call notifyWorkflowUpdate
        expect(onMessageBody).toMatch(/edgeLabelUpdate[\s\S]*notifyWorkflowUpdate/);
    });

    it('should have editEdgeLabel case in extension provider message handler', () => {
        expect(providerContent).toContain("'editEdgeLabel'");
    });

    it('should use vscode.window.showInputBox for edge label editing in provider', () => {
        expect(providerContent).toMatch(/editEdgeLabel[\s\S]*showInputBox/);
    });

    it('should post edgeLabelUpdate message back to webview from provider', () => {
        expect(providerContent).toMatch(/editEdgeLabel[\s\S]*edgeLabelUpdate/);
    });

    it('should set editingEdgeId state when starting label edit', () => {
        const onDoubleClickBody = extractFunctionBody(designerContent, 'onDoubleClick');
        expect(onDoubleClickBody).not.toBeNull();
        expect(onDoubleClickBody).toContain('editingEdgeId');
    });

    it('should clear editingEdgeId after label update completes', () => {
        const onMessageBody = extractFunctionBody(designerContent, 'onMessage');
        expect(onMessageBody).not.toBeNull();
        expect(onMessageBody).toMatch(/edgeLabelUpdate[\s\S]*editingEdgeId\s*=\s*null/);
    });
});

// ===== Integration: No regressions =====

describe('Integration: Edge features do not break existing functionality', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    it('should still have all original state fields', () => {
        expect(designerContent).toContain('workflow:');
        expect(designerContent).toContain('selectedNodeIds:');
        expect(designerContent).toContain('draggingNode:');
        expect(designerContent).toContain('creatingEdge:');
        expect(designerContent).toContain('panning:');
        expect(designerContent).toContain('viewport:');
        expect(designerContent).toContain('executionStatus:');
        expect(designerContent).toContain('editMode:');
    });

    it('should still have original canvas event listeners', () => {
        expect(designerContent).toMatch(/addEventListener\('mousedown',\s*onMouseDown/);
        expect(designerContent).toMatch(/addEventListener\('mousemove',\s*onMouseMove/);
        expect(designerContent).toMatch(/addEventListener\('mouseup',\s*onMouseUp/);
        expect(designerContent).toMatch(/addEventListener\('wheel',\s*onWheel/);
    });

    it('should still have drawNode function', () => {
        expect(designerContent).toMatch(/function\s+drawNode\s*\(/);
    });

    it('should still have drawPorts function', () => {
        expect(designerContent).toMatch(/function\s+drawPorts\s*\(/);
    });

    it('should still have hitTestNodes function', () => {
        expect(designerContent).toMatch(/function\s+hitTestNodes\s*\(/);
    });

    it('should still have hitTestOutputPorts function', () => {
        expect(designerContent).toMatch(/function\s+hitTestOutputPorts\s*\(/);
    });

    it('should still have hitTestInputPorts function', () => {
        expect(designerContent).toMatch(/function\s+hitTestInputPorts\s*\(/);
    });

    it('should still have deleteSelectedNodes function', () => {
        expect(designerContent).toMatch(/function\s+deleteSelectedNodes\s*\(/);
    });

    it('should still have saveHistory function', () => {
        expect(designerContent).toMatch(/function\s+saveHistory\s*\(/);
    });

    it('should still have notifyWorkflowUpdate function', () => {
        expect(designerContent).toMatch(/function\s+notifyWorkflowUpdate\s*\(/);
    });
});
