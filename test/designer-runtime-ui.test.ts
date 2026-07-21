/**
 * Behavioral UI runtime tests for webview designer animation sequencing.
 *
 * These tests execute the real designer runtime in jsdom, then assert the
 * animation state machine behavior for execution updates.
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

    return stubCtx;
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

describe('designer runtime UI sequencing', () => {
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
                name: 'test-sequence',
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

    it('keeps destination node visually waiting during edge handoff and pulses after handoff completes', () => {
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

        let snapshot = api.getAnimationSnapshot();
        expect(snapshot.edgeAnimations['start_1->agent_1']).toBeDefined();
        expect(snapshot.pendingNodePulses['agent_1']).toBe(7000);
        expect(api.getVisualStatus('agent_1', 'running')).toBe('waiting');

        api.tickTo(3500);
        snapshot = api.getAnimationSnapshot();
        expect(snapshot.pendingNodePulses['agent_1']).toBe(7000);
        expect(snapshot.nodeAnimations['agent_1']).toBeUndefined();

        api.tickTo(7100);
        snapshot = api.getAnimationSnapshot();
        expect(snapshot.pendingNodePulses['agent_1']).toBeUndefined();
        expect(snapshot.nodeAnimations['agent_1']).toBeDefined();
        expect(snapshot.nodeAnimations['agent_1'].mode).toBe('pulse');
    });

    it('does not show node as running while its incoming edge handoff is still animating', () => {
        const api = (window as any).__workflowDesignerTestApi;

        api.simulateExecutionUpdate(
            workflowStatus({
                currentNodeId: 'agent_1',
                nodeStatuses: {
                    start_1: { status: 'completed' },
                    agent_1: { status: 'running' },
                },
            }),
            1500
        );

        const snapshot = api.getAnimationSnapshot();
        expect(snapshot.edgeAnimations['start_1->agent_1']).toBeDefined();
        expect(snapshot.pendingNodePulses['agent_1']).toBeDefined();
        expect(api.getVisualStatus('agent_1', 'running')).toBe('waiting');
    });

    it('uses configured edge handoff duration when scheduling transition', () => {
        const api = (window as any).__workflowDesignerTestApi;

        api.simulateMessage({
            type: 'init',
            workflow: {
                name: 'test-sequence',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 50, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_1', type: 'agent', position: { x: 240, y: 50 }, data: { agent: 'builder' } },
                ],
                edges: [{ id: 'start_1->agent_1', source: 'start_1', target: 'agent_1' }],
            },
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 1500,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        api.simulateExecutionUpdate(
            workflowStatus({
                currentNodeId: 'agent_1',
                nodeStatuses: {
                    start_1: { status: 'completed' },
                    agent_1: { status: 'running' },
                },
            }),
            500
        );

        const snapshot = api.getAnimationSnapshot();
        expect(snapshot.pendingNodePulses['agent_1']).toBe(5000);
    });
});
