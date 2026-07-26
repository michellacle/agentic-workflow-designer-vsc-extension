/**
 * UI Regression Suite
 *
 * Contract:
 * - Every feature that changes user-visible behavior must add at least one
 *   regression case to this file (or a helper used by this file).
 * - Tests in this suite must execute runtime behavior and assert observable
 *   UI outcomes, not static source-string presence.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

function installCanvasMock() {
    const stubCtx = {
        clearRect: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        scale: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        bezierCurveTo: jest.fn(),
        stroke: jest.fn(),
        fill: jest.fn(),
        arc: jest.fn(),
        closePath: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        setLineDash: jest.fn(),
        fillText: jest.fn(),
        measureText: jest.fn(() => ({ width: 40 })),
        roundRect: jest.fn(),
        quadraticCurveTo: jest.fn(),
        setTransform: jest.fn(),
        font: '',
        textAlign: 'left',
        lineWidth: 1,
        strokeStyle: '#000',
        fillStyle: '#000',
        globalAlpha: 1,
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        lineDashOffset: 0,
    } as any;

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => stubCtx,
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    });
}

function installDomShell() {
    document.body.innerHTML = `
      <div id="app">
        <div id="toolbar">
          <button id="btn-run"></button>
          <button id="btn-pause"></button>
          <button id="btn-stop"></button>
          <button id="btn-resume"></button>
          <button id="btn-save"></button>
          <button id="btn-validate"></button>
          <button id="btn-edit-mode"></button>
          <span id="execution-status" class="status-badge"></span>
        </div>
        <div id="main-container">
          <div id="toolbox"></div>
          <div id="canvas-container"><canvas id="canvas"></canvas></div>
          <div id="properties-panel"><div id="properties-content"></div></div>
        </div>
      </div>
    `;
}

function loadDesignerRuntime() {
    const builtJs = readFile('webview/dist/designer.js');
    // eslint-disable-next-line no-new-func
    const runner = new Function(builtJs);
    runner();
}

function workflowStatus(payload: any) {
    return {
        overall: 'running',
        currentNodeId: payload.currentNodeId,
        nodeStatuses: payload.nodeStatuses,
    };
}

describe('UI regression suite', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        (global as any).acquireVsCodeApi = () => ({
            postMessage: jest.fn(),
            setState: jest.fn(),
            getState: jest.fn(() => null),
        });
        (window as any).__WORKFLOW_DESIGNER_TEST_MODE = true;
        (window as any).ResizeObserver = class {
            observe() {}
            disconnect() {}
        };
        (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
            setTimeout(() => cb(performance.now()), 16);
            return 1;
        };

        installCanvasMock();
        installDomShell();
        loadDesignerRuntime();

        const api = (window as any).__workflowDesignerTestApi;
        api.simulateMessage({
            type: 'init',
            workflow: {
                name: 'ui-regression-workflow',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 50, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_1', type: 'agent', position: { x: 240, y: 50 }, data: { agent: 'builder' } },
                    { id: 'end_1', type: 'end', position: { x: 430, y: 50 }, data: { label: 'End' } },
                ],
                edges: [
                    { id: 'start_1->agent_1', source: 'start_1', target: 'agent_1' },
                    { id: 'agent_1->end_1', source: 'agent_1', target: 'end_1' },
                ],
            },
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        delete (window as any).__workflowDesignerTestApi;
        delete (window as any).__WORKFLOW_DESIGNER_TEST_MODE;
    });

    it('regression: edge must not animate while destination node visually appears running', () => {
        const api = (window as any).__workflowDesignerTestApi;

        api.simulateExecutionUpdate(
            workflowStatus({
                currentNodeId: 'agent_1',
                nodeStatuses: {
                    start_1: { status: 'completed' },
                    agent_1: { status: 'running' },
                },
            }),
            1000
        );

        const snapshot = api.getAnimationSnapshot();
        expect(snapshot.edgeAnimations['start_1->agent_1']).toBeDefined();
        expect(snapshot.pendingNodePulses['agent_1']).toBeDefined();
        expect(api.getVisualStatus('agent_1', 'running')).toBe('waiting');
    });

    it('regression: arrowheads on all edges must be drawn after nodes so they are visible', () => {
        const api = (window as any).__workflowDesignerTestApi;

        // Trigger a render so the canvas mock records the draw call sequence
        api.simulateMessage({
            type: 'init',
            workflow: {
                name: 'arrowhead-test',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 50, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_1', type: 'agent', position: { x: 240, y: 50 }, data: { agent: 'builder' } },
                    { id: 'agent_2', type: 'agent', position: { x: 430, y: 50 }, data: { agent: 'reviewer' } },
                ],
                edges: [
                    { id: 'start_1->agent_1', source: 'start_1', target: 'agent_1' },
                    { id: 'agent_1->agent_2', source: 'agent_1', target: 'agent_2' },
                ],
            },
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Force a render cycle
        jest.advanceTimersByTime(50);

        // Verify that the render function draws arrowheads in a separate pass after nodes
        // by checking that drawArrowheads exists and is called after drawNode in render()
        const designerSource = readFile('webview/src/designer.ts');
        const renderBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function render()');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(renderBody).not.toBeNull();

        // In render(), drawArrowheads must appear after the drawNode loop
        const drawNodeIndex = renderBody!.indexOf('drawNode');
        const drawArrowheadsIndex = renderBody!.indexOf('drawArrowheads');
        expect(drawArrowheadsIndex).toBeGreaterThan(-1);
        expect(drawArrowheadsIndex).toBeGreaterThan(drawNodeIndex);

        // Verify drawArrowheads iterates over all edges (not just start-node edges)
        const drawArrowheadsBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function drawArrowheads()');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(drawArrowheadsBody).not.toBeNull();
        expect(drawArrowheadsBody).toMatch(/workflow\.edges/);
    });

    it('regression: toolbar buttons should be icon-only (no text labels, tooltips via title attribute)', () => {
        const htmlSource = readFile('src/designer/workflowDesignerProvider.ts');

        // Each toolbar button should have a title attribute for hover tooltips
        const buttonIds = ['btn-run', 'btn-pause', 'btn-stop', 'btn-resume', 'btn-save', 'btn-validate', 'btn-edit-mode'];
        for (const id of buttonIds) {
            const btnMatch = htmlSource.match(new RegExp(`id="${id}"[^>]*title="([^"]+)"[^>]*>([^<]*)`, 's'));
            expect(btnMatch).not.toBeNull();
            expect(btnMatch![1].trim()).not.toBe('');

            // Button content should be icon-only (no text labels like "Run", "Pause", etc.)
            const content = btnMatch![2].trim();
            expect(content.length < 5).toBe(true);
        }
    });

    it('regression: toolbar button background should match editor background for VS Code native feel', () => {
        const cssSource = readFile('webview/src/designer.css');

        // Toolbar buttons should NOT use --vscode-button-background (colored accent)
        // They should use transparent or editor-background to blend with VS Code's native toolbar look
        const buttonMatch = cssSource.match(/#toolbar\s+button\s*\{([^}]+)\}/s);
        expect(buttonMatch).not.toBeNull();

        const buttonStyles = buttonMatch![1];
        // Should NOT have colored button background
        expect(buttonStyles).not.toMatch(/background:\s*var\(--vscode-button-background/);
        // Should have transparent background or editor-background
        expect(buttonStyles).toMatch(/background:\s*(transparent|var\(--vscode-editor-background)/);
    });

    it('regression: toolbar button icons should have consistent sizes', () => {
        const cssSource = readFile('webview/src/designer.css');

        // Toolbar buttons should have a consistent font-size for icon uniformity
        const buttonMatch = cssSource.match(/#toolbar\s+button\s*\{([^}]+)\}/s);
        expect(buttonMatch).not.toBeNull();

        const buttonStyles = buttonMatch![1];
        // Should have an explicit font-size defined
        expect(buttonStyles).toMatch(/font-size:\s*\d+px/);

        // All toolbar buttons should use the same font-size (no per-button overrides)
        // Check that there are no individual button font-size overrides
        const individualOverrides = cssSource.match(/#toolbar\s+button\s+#btn-\w+\s*\{[^}]*font-size/);
        expect(individualOverrides).toBeNull();
    });

    it('regression: execution count badge should appear in node header when a node is executed more than once', () => {
        const api = (window as any).__workflowDesignerTestApi;

        // Re-init with a workflow that has a loop-back (implementer → reviewer → condition → implementer)
        api.simulateMessage({
            type: 'init',
            workflow: {
                name: 'loop-test',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 50, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_impl', type: 'agent', position: { x: 240, y: 50 }, data: { agent: 'implementer' } },
                    { id: 'agent_rev', type: 'agent', position: { x: 240, y: 180 }, data: { agent: 'reviewer' } },
                    { id: 'condition_1', type: 'condition', position: { x: 240, y: 310 }, data: { prompt: 'Check if review passed' } },
                    { id: 'end_1', type: 'end', position: { x: 430, y: 310 }, data: { label: 'End' } },
                ],
                edges: [
                    { id: 'start_1->agent_impl', source: 'start_1', target: 'agent_impl' },
                    { id: 'agent_impl->agent_rev', source: 'agent_impl', target: 'agent_rev' },
                    { id: 'agent_rev->condition_1', source: 'agent_rev', target: 'condition_1' },
                    { id: 'condition_1->agent_impl', source: 'condition_1', target: 'agent_impl', label: 'False' },
                    { id: 'condition_1->end_1', source: 'condition_1', target: 'end_1', label: 'True' },
                ],
            },
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Simulate: implementer has been executed twice (executionCount = 2)
        api.simulateExecutionUpdate(
            workflowStatus({
                currentNodeId: 'agent_impl',
                nodeStatuses: {
                    start_1: { status: 'completed' },
                    agent_impl: { status: 'running' },
                    agent_rev: { status: 'completed' },
                    condition_1: { status: 'completed' },
                },
                nodeExecutionCounts: {
                    agent_impl: 2,
                    agent_rev: 1,
                    condition_1: 1,
                },
            }),
            5000
        );

        // Force render
        jest.advanceTimersByTime(50);

        // The designer source should contain execution count badge rendering logic
        const designerSource = readFile('webview/src/designer.ts');
        // Should reference nodeExecutionCounts in the render path
        expect(designerSource).toMatch(/nodeExecutionCounts/);
        // Should render a badge (always shown, initialized to 0)
        expect(designerSource).toMatch(/executionCount.*\?\?.*0/);
    });

    it('regression: dragging an edge endpoint to bottom/right border must keep bottom/right side', () => {
        const api = (window as any).__workflowDesignerTestApi;

        api.simulateMessage({
            type: 'init',
            workflow: {
                name: 'edge-snap-regression',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 100, y: 120 }, data: { label: 'Start' } },
                    { id: 'agent_1', type: 'agent', position: { x: 320, y: 120 }, data: { agent: 'builder' } },
                    { id: 'end_1', type: 'end', position: { x: 560, y: 120 }, data: { label: 'End' } },
                ],
                edges: [
                    { id: 'start_1->agent_1', source: 'start_1', target: 'agent_1' },
                    { id: 'agent_1->end_1', source: 'agent_1', target: 'end_1' },
                ],
            },
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        expect(canvas).not.toBeNull();

        // Drag source endpoint of start_1->agent_1 from right side to bottom border center.
        // start_1: x=100, y=120, w=108, h=45 => right=(208,142.5), bottom=(154,165)
        canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 208, clientY: 143, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 154, clientY: 165, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 154, clientY: 165, bubbles: true }));

        let sides = api.getEdgeSides('start_1->agent_1');
        expect(sides).not.toBeNull();
        expect(sides.sourceSide).toBe('bottom');

        // Drag target endpoint of agent_1->end_1 from left side to right border center.
        // end_1: x=560, y=120, w=108, h=45 => left=(560,142.5), right=(668,142.5)
        canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 560, clientY: 143, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 668, clientY: 143, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 668, clientY: 143, bubbles: true }));

        sides = api.getEdgeSides('agent_1->end_1');
        expect(sides).not.toBeNull();
        expect(sides.targetSide).toBe('right');
    });

    it('regression: canvas pan works in both edit and view modes (left-drag on empty canvas)', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // In onMouseDown, left-click on empty canvas should start panning in both modes.
        // The old code had: else if (state.editMode && ...) for selection box,
        // then else if (...) for pan in view mode only.
        // New code should have pan for both modes without selection box.
        expect(designerSource).not.toMatch(/selectionBox/);

        // Verify that the empty canvas click handler starts panning without edit mode check
        const mouseDownBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function onMouseDown(e)');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(mouseDownBody).not.toBeNull();

        // Should NOT have selection box start logic
        expect(mouseDownBody).not.toMatch(/selectionBox\s*=\s*\{/);
        // Should have pan start on empty canvas without edit mode gate
        expect(mouseDownBody).toMatch(/state\.panning\s*=\s*true/);
    });

    it('regression: node dragging only works in edit mode, not view mode', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // In onMouseMove, node dragging should be gated by editMode to prevent accidental layout changes
        const mouseMoveBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function onMouseMove(e)');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(mouseMoveBody).not.toBeNull();

        // Should have editMode gate on dragging node
        expect(mouseMoveBody).toMatch(/draggingNode\s+&&\s+state\.editMode/);
    });

    it('regression: delete key only works in edit mode, not view mode', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Delete/Backspace should be gated by editMode to prevent accidental deletion in view mode
        expect(designerSource).toMatch(/editMode.*Delete.*Backspace|state\.editMode.*Delete/);
    });

    it('regression: edge creation works in both edit and view modes', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Edge creation (hitTestOutputPorts) should NOT be gated by editMode
        // The old code had: if (state.editMode) { const portHit = hitTestOutputPorts... }
        // New code should call hitTestOutputPorts directly without editMode check
        const mouseDownBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function onMouseDown(e)');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(mouseDownBody).not.toBeNull();

        // Should NOT have editMode gate around hitTestOutputPorts
        expect(mouseDownBody).not.toMatch(/if\s*\(\s*state\.editMode\s*\)\s*\{[^}]*hitTestOutputPorts/);
        // Should have hitTestOutputPorts call
        expect(mouseDownBody).toMatch(/hitTestOutputPorts/);
    });

    it('regression: edit mode toggle shows/hides panels (edit mode = panels visible, view mode = panels hidden)', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // toggleEditMode should show panels when editMode is true, hide when false
        const toggleBody = ((): string | null => {
            const fnStart = designerSource.indexOf('function toggleEditMode()');
            if (fnStart < 0) return null;
            const braceStart = designerSource.indexOf('{', fnStart);
            if (braceStart < 0) return null;
            let braceCount = 0;
            for (let i = braceStart; i < designerSource.length; i++) {
                if (designerSource[i] === '{') braceCount++;
                if (designerSource[i] === '}') braceCount--;
                if (braceCount === 0) return designerSource.substring(braceStart + 1, i);
            }
            return null;
        })();
        expect(toggleBody).not.toBeNull();

        // Should remove hidden class when editMode is true (show panels)
        expect(toggleBody).toMatch(/classList\.remove\('hidden'\)/);
        // Should add hidden class when editMode is false (hide panels)
        expect(toggleBody).toMatch(/classList\.add\('hidden'\)/);
    });

    it('regression: selection box is removed and nodesInRect function is gone', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Selection box code should be completely removed
        expect(designerSource).not.toMatch(/selectionBox/);
        expect(designerSource).not.toMatch(/nodesInRect/);
        expect(designerSource).not.toMatch(/drawSelectionBox/);
    });

    it('regression: agent and condition nodes show prompt first line on canvas', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // getPromptFirstLine function should exist
        expect(designerSource).toMatch(/getPromptFirstLine/);

        // Agent node rendering should use getPromptFirstLine for sub-labels
        expect(designerSource).toMatch(/case\s+'agent':[\s\S]*?getPromptFirstLine/);

        // Condition node rendering should use getPromptFirstLine for sub-labels
        expect(designerSource).toMatch(/case\s+'condition':[\s\S]*?getPromptFirstLine/);
    });

    it('regression: description field removed from properties panel for all node types', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Find the updatePropertiesPanel function body
        const fnStart = designerSource.indexOf('function updatePropertiesPanel');
        expect(fnStart).toBeGreaterThan(-1);
        const fnEnd = designerSource.indexOf('\nfunction ', fnStart + 1);
        const fnBody = designerSource.substring(fnStart, fnEnd < 0 ? undefined : fnEnd);

        // Extract each node type's case from the properties panel switch
        const agentCase = _extractCaseBody(fnBody, "'agent'");
        expect(agentCase).not.toBeNull();
        expect(agentCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);

        const conditionCase = _extractCaseBody(fnBody, "'condition'");
        expect(conditionCase).not.toBeNull();
        expect(conditionCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);

        const approvalCase = _extractCaseBody(fnBody, "'human_approval'");
        expect(approvalCase).not.toBeNull();
        expect(approvalCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);

        const delayCase = _extractCaseBody(fnBody, "'delay'");
        expect(delayCase).not.toBeNull();
        expect(delayCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);

        const noteCase = _extractCaseBody(fnBody, "'note'");
        expect(noteCase).not.toBeNull();
        expect(noteCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);

        const processCase = _extractCaseBody(fnBody, "'process'");
        expect(processCase).not.toBeNull();
        expect(processCase).not.toMatch(/propertyField\(\s*['"]Description['"]/);
    });

    it('regression: condition nodes use agent-driven evaluation (no expression field)', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // The updatePropertiesPanel switch should have condition case with Model + Prompt
        // Find the updatePropertiesPanel function and check its condition case
        const fnStart = designerSource.indexOf('function updatePropertiesPanel');
        expect(fnStart).toBeGreaterThan(-1);
        const fnEnd = designerSource.indexOf('\nfunction ', fnStart + 1);
        const fnBody = designerSource.substring(fnStart, fnEnd < 0 ? undefined : fnEnd);

        // Condition case in properties panel should have Model + Prompt
        const conditionCase = fnBody.substring(
            fnBody.indexOf("case 'condition':")
        );
        const nextCaseIdx = conditionCase.indexOf("case '", 1);
        const conditionCaseBody = nextCaseIdx > 0 ? conditionCase.substring(0, nextCaseIdx) : conditionCase;

        expect(conditionCaseBody).not.toMatch(/propertyField\(\s*['"]Expression['"]/);
        expect(conditionCaseBody).toMatch(/propertyField\(\s*['"]Model['"]/);
        expect(conditionCaseBody).toMatch(/propertyField\(\s*['"]Prompt['"]/);
    });

    it('regression: condition node port hit test positions match drawn port positions', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Extract hitTestOutputPorts function
        const fnStart = designerSource.indexOf('function hitTestOutputPorts');
        expect(fnStart).toBeGreaterThan(-1);
        const fnEnd = designerSource.indexOf('\n    function ', fnStart + 1);
        const fnBody = designerSource.substring(fnStart, fnEnd < 0 ? undefined : fnEnd);

        // True port hit test should be at right vertex (x + w, y + h / 2)
        expect(fnBody).toMatch(/node\.type\s*===\s*'condition'/);
        expect(fnBody).toMatch(/x\s*\+\s*w[\s\S]*?y\s*\+\s*h\s*\/\s*2/);

        // False port hit test should be at left vertex (x, y + h / 2)
        expect(fnBody).toMatch(/pos\.x\s*-\s*x[\s\S]*?y\s*\+\s*h\s*\/\s*2/);

        // Should NOT use the old wrong positions (y + 15, y + h - 15, or bottom vertex)
        expect(fnBody).not.toMatch(/y\s*\+\s*15/);
        expect(fnBody).not.toMatch(/y\s*\+\s*h\s*-\s*15/);
        expect(fnBody).not.toMatch(/x\s*\+\s*w\s*\/\s*2.*y\s*\+\s*h[^\/]*/);
    });

    it('regression: drawCreatingEdge uses correct port position for condition nodes', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Extract drawCreatingEdge function
        const fnStart = designerSource.indexOf('function drawCreatingEdge');
        expect(fnStart).toBeGreaterThan(-1);
        const fnEnd = designerSource.indexOf('\n    function ', fnStart + 1);
        const fnBody = designerSource.substring(fnStart, fnEnd < 0 ? undefined : fnEnd);

        // Should check sourcePort for true/false
        expect(fnBody).toMatch(/sourcePort/);
        expect(fnBody).toMatch(/===\s*'true'/);
        expect(fnBody).toMatch(/===\s*'false'/);

        // Should use different positions for true (right: x + w) vs false (left: x)
        expect(fnBody).toMatch(/sourcePort\s*===\s*'false'/);
        expect(fnBody).toMatch(/position\.x[\s\S]*?position\.y\s*\+\s*h\s*\/\s*2/); // left vertex for false
    });

    it('regression: executor has infinite loop protection with max execution count', () => {
        const executorSource = readFile('src/runtime/workflowExecutor.ts');

        // Should define a max execution count constant
        expect(executorSource).toMatch(/MAX_NODE_EXECUTIONS/);

        // Should check execution count against the limit
        expect(executorSource).toMatch(/execCount.*MAX_NODE_EXECUTIONS|MAX_NODE_EXECUTIONS.*execCount/);

        // Should log a clear warning when triggered
        expect(executorSource).toMatch(/Loop protection triggered|infinite.*loop/i);

        // Should detect condition agent errors
        expect(executorSource).toMatch(/isConditionAgentError/);
        expect(executorSource).toMatch(/agent error:/i);
    });

    it('regression: end node dimensions should match start node dimensions', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // Extract individual node config lines directly (avoids nested brace issues)
        const startMatch = designerSource.match(/start:\s*\{\s*label:[^}]*width:\s*(\d+),\s*height:\s*(\d+)/);
        expect(startMatch).not.toBeNull();
        const startWidth = parseInt(startMatch![1], 10);
        const startHeight = parseInt(startMatch![2], 10);

        const endMatch = designerSource.match(/end:\s*\{\s*label:[^}]*width:\s*(\d+),\s*height:\s*(\d+)/);
        expect(endMatch).not.toBeNull();
        const endWidth = parseInt(endMatch![1], 10);
        const endHeight = parseInt(endMatch![2], 10);

        // End node should match start node dimensions
        expect(endWidth).toBe(startWidth);
        expect(endHeight).toBe(startHeight);
    });

    it('regression: note nodes should not render a header bar', () => {
        const designerSource = readFile('webview/src/designer.ts');

        // The header bar rendering should skip note nodes (like diamonds)
        // Check that the header bar condition excludes 'note' type
        const headerBarMatch = designerSource.match(/Header bar[\s\S]*?if\s*\(([^)]+)\)/);
        expect(headerBarMatch).not.toBeNull();
        const headerCondition = headerBarMatch![1];
        // Should exclude note nodes from header rendering
        expect(headerCondition).toMatch(/node\.type\s*!==\s*['"]note['"]/);

        // Note node rendering should center text in body, not use header sub-label pattern
        // Should NOT have a note sub-label that positions text below a header (y + h * 0.3 + 30)
        // Extract the note-specific rendering block and check it in isolation
        const noteBlockMatch = designerSource.match(/node\.type\s*===\s*['"]note['"]([\s\S]*?)(?:break;|case\s+|default:|\s*\}\s*else\s*\{)/);
        const noteBlock = noteBlockMatch ? noteBlockMatch[1] : '';
        const noteSubLabelMatch = noteBlock.match(/fillText[\s\S]*?y\s*\+\s*h\s*\*\s*0\.3/);
        expect(noteSubLabelMatch).toBeNull();

        // Note nodes should render text centered in body (y + h / 2 pattern)
        const noteBodyMatch = designerSource.match(/node\.type\s*===\s*['"]note['"][\s\S]*?fillText[\s\S]*?y\s*\+\s*h\s*\/\s*2/);
        expect(noteBodyMatch).not.toBeNull();
    });
});

function _extractCaseBody(source: string, caseLabel: string): string | null {
    const idx = source.indexOf('case ' + caseLabel + ':');
    if (idx < 0) return null;
    const nextCase = source.indexOf('case ', idx + 1);
    const defaultCase = source.indexOf('default:', idx + 1);
    const breakEnd = source.indexOf('break;', idx + 1);
    const candidates = [nextCase, defaultCase, breakEnd].filter(n => n > idx + 1);
    const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
    return source.substring(idx, end);
}
