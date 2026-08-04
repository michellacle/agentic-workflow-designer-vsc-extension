/**
 * Standalone Designer Test Suite
 *
 * Tests the designer module through the MessagingHarness seam using
 * TestingHarness — no VS Code extension build/install/reload cycle needed.
 *
 * Happy path: user creates a workflow with Start → Agent → End nodes.
 */

import { TestingHarness } from '../webview/src/testingHarness';
import { createDesigner } from '../webview/src/designer';

let harness: TestingHarness;

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

describe('Standalone Designer — happy path', () => {
    beforeEach(() => {
        jest.useFakeTimers();
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

        harness = new TestingHarness();
        createDesigner(harness, document.getElementById('app')!);
    });

    afterEach(() => {
        jest.useRealTimers();
        delete (window as any).__workflowDesignerTestApi;
        delete (window as any).__WORKFLOW_DESIGNER_TEST_MODE;
    });

    it('user creates a workflow with Start → Agent → End nodes', () => {
        const api = (window as any).__workflowDesignerTestApi;

        // Step 1: Host sends init with an empty workflow
        harness.send({
            type: 'init',
            workflow: {
                name: 'my-workflow',
                nodes: [],
                edges: [],
            },
            agentFiles: ['general', 'reviewer'],
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Step 2: Simulate user adding a Start node (host sends updated workflow)
        harness.send({
            type: 'init',
            workflow: {
                name: 'my-workflow',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 350, y: 50 }, data: { label: 'Start' } },
                ],
                edges: [],
            },
            agentFiles: ['general', 'reviewer'],
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Verify: workflow snapshot has the Start node
        let snapshot = api.getWorkflowSnapshot();
        expect(snapshot.nodes.length).toBe(1);
        expect(snapshot.nodes[0].type).toBe('start');

        // Step 3: Simulate user adding an Agent node
        harness.send({
            type: 'init',
            workflow: {
                name: 'my-workflow',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 350, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_2', type: 'agent', position: { x: 300, y: 180 }, data: { agent: 'general', prompt: 'Do something' } },
                ],
                edges: [
                    { id: 'edge_1', source: 'start_1', target: 'agent_2', sourceSide: 'bottom', targetSide: 'top' },
                ],
            },
            agentFiles: ['general', 'reviewer'],
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Verify: workflow snapshot has Start + Agent + edge
        snapshot = api.getWorkflowSnapshot();
        expect(snapshot.nodes.length).toBe(2);
        expect(snapshot.edges.length).toBe(1);
        expect(snapshot.nodes[1].type).toBe('agent');
        expect(snapshot.edges[0].source).toBe('start_1');
        expect(snapshot.edges[0].target).toBe('agent_2');

        // Step 4: Simulate user adding an End node
        harness.send({
            type: 'init',
            workflow: {
                name: 'my-workflow',
                nodes: [
                    { id: 'start_1', type: 'start', position: { x: 350, y: 50 }, data: { label: 'Start' } },
                    { id: 'agent_2', type: 'agent', position: { x: 300, y: 180 }, data: { agent: 'general', prompt: 'Do something' } },
                    { id: 'end_3', type: 'end', position: { x: 350, y: 320 }, data: { label: 'End' } },
                ],
                edges: [
                    { id: 'edge_1', source: 'start_1', target: 'agent_2', sourceSide: 'bottom', targetSide: 'top' },
                    { id: 'edge_2', source: 'agent_2', target: 'end_3', sourceSide: 'bottom', targetSide: 'top' },
                ],
            },
            agentFiles: ['general', 'reviewer'],
            animationConfig: {
                startNodeFlashMs: 3000,
                edgeHandoffMs: 3000,
                endNodeFlashMs: 1200,
                edgeDashSpeed: 20,
            },
        });

        // Verify: complete workflow has 3 nodes and 2 edges
        snapshot = api.getWorkflowSnapshot();
        expect(snapshot.nodes.length).toBe(3);
        expect(snapshot.edges.length).toBe(2);

        const nodeTypes = snapshot.nodes.map((n: any) => n.type);
        expect(nodeTypes).toContain('start');
        expect(nodeTypes).toContain('agent');
        expect(nodeTypes).toContain('end');

        // Verify: TestingHarness captured all posted messages
        // The designer posts messages when the user modifies the workflow.
        // Simulate a toolbar click (save) to trigger a postMessage.
        const saveBtn = document.getElementById('btn-save');
        saveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const allMessages = harness.postedMessages;
        expect(allMessages.length).toBeGreaterThan(0);
        expect(allMessages.find(m => m.type === 'save')).toBeDefined();

        // Verify: workflow snapshot matches what we sent (designer rendered it)
        expect(snapshot.name).toBe('my-workflow');
        expect(snapshot.nodes.length).toBe(3);
        expect(snapshot.edges.length).toBe(2);

        // Step 5: Simulate execution update (Start completed, Agent running)
        harness.send({
            type: 'executionUpdate',
            status: {
                overall: 'running',
                currentNodeId: 'agent_2',
                nodeStatuses: {
                    start_1: { status: 'completed' },
                    agent_2: { status: 'running' },
                    end_3: { status: 'waiting' },
                },
            },
        });

        // Verify: execution status UI updated
        const statusBadge = document.getElementById('execution-status');
        expect(statusBadge).not.toBeNull();
        expect(statusBadge!.textContent).toBe('running');

        // Verify: animation snapshot reflects running state
        const animSnapshot = api.getAnimationSnapshot();
        expect(animSnapshot.edgeAnimations).toBeDefined();
        expect(animSnapshot.nodeAnimations).toBeDefined();
    });
});
