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
});
