/**
 * Workflow Designer - Webview JavaScript
 * Canvas-based visual workflow editor
 */

(function () {
    'use strict';

    // ===== Error Display =====
    function showError(msg) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1e1e1e;color:#f44336;font-family:system-ui;padding:40px;text-align:center;"><div><h2>Workflow Designer Error</h2><p>' + msg + '</p><p style="color:#888;margin-top:16px;font-size:12px;">Check the Developer Tools console for details.</p></div></div>';
        console.error('Workflow Designer Error:', msg);
    }

    // ===== State =====
    const state = {
        workflow: { name: 'untitled', nodes: [], edges: [] },
        selectedNodeIds: new Set(),
        draggingNode: null,
        draggingOffset: { x: 0, y: 0 },
        creatingEdge: null, // { sourceNodeId, sourcePort, currentX, currentY }
        panning: false,
        panStart: { x: 0, y: 0 },
        viewport: { x: 0, y: 0, zoom: 1 },
        nodeCounter: 0,
        executionStatus: null,
        history: [],
        historyIndex: -1
    };

    // ===== VS Code API =====
    let vscode: any;
    try {
        vscode = acquireVsCodeApi();
    } catch (e: any) {
        showError('Failed to acquire VS Code API: ' + e.message);
        return;
    }

    // ===== Canvas Setup =====
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        showError('Canvas element not found. DOM may not be ready.');
        return;
    }

    let ctx: CanvasRenderingContext2D | null;
    try {
        ctx = canvas.getContext('2d');
    } catch (e: any) {
        showError('Failed to get canvas 2D context: ' + e.message);
        return;
    }
    if (!ctx) {
        showError('Failed to get canvas 2D context.');
        return;
    }

    const canvasContainer = document.getElementById('canvas-container') as HTMLElement;
    if (!canvasContainer) {
        showError('Canvas container element not found.');
        return;
    }

    // ===== Node Configurations =====
    const NODE_CONFIGS = {
        start: { label: 'Start', color: '#4CAF50', width: 120, height: 50, icon: '●' },
        end: { label: 'End', color: '#f44336', width: 120, height: 50, icon: '●' },
        agent: { label: 'Agent', color: '#2196F3', width: 140, height: 90, icon: '🤖' },
        condition: { label: 'Condition', color: '#FF9800', width: 140, height: 70, icon: '◇' },
        human_approval: { label: 'Approval', color: '#9C27B0', width: 140, height: 70, icon: '👤' },
        delay: { label: 'Delay', color: '#607D8B', width: 140, height: 70, icon: '⏱' }
    };

    // Execution status colors
    const STATUS_COLORS = {
        waiting: '#9E9E9E',
        running: '#2196F3',
        completed: '#4CAF50',
        failed: '#f44336',
        paused: '#FFC107',
        skipped: '#BDBDBD'
    };

    // ===== Initialization =====
    function init() {
        console.log('[Designer] init() called');

        window.addEventListener('resize', resizeCanvas);

        // Canvas events
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Keyboard events
        document.addEventListener('keydown', onKeyDown);

        // Toolbox drag events
        setupToolbox();

        // Toolbar events
        setupToolbar();

        // VS Code messages
        window.addEventListener('message', onMessage);

        // Try to size canvas - use multiple strategies for reliability
        function tryResize() {
            const rect = canvasContainer.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                resizeCanvas();
                return true;
            }
            return false;
        }

        // Strategy 1: ResizeObserver (most reliable)
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                if (tryResize()) ro.disconnect();
            });
            ro.observe(canvasContainer);
        }

        // Strategy 2: requestAnimationFrame (runs after layout)
        requestAnimationFrame(tryResize);

        // Strategy 3: setTimeout fallback (in case layout is delayed)
        setTimeout(() => tryResize(), 100);
        setTimeout(() => tryResize(), 500);
    }

    // ===== Canvas Resize =====
    function resizeCanvas() {
        const rect = canvasContainer.getBoundingClientRect();
        console.log('[Designer] resizeCanvas:', rect.width, 'x', rect.height);
        if (rect.width === 0 || rect.height === 0) {
            console.warn('[Designer] Container has zero dimensions, skipping resize');
            return;
        }
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        // Reset transform before re-applying scale (avoids compounding on resize)
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        console.log('[Designer] canvas set to', canvas.width, 'x', canvas.height);
        render();
    }

    // ===== Rendering =====
    function render() {
        const w = canvas.width / window.devicePixelRatio;
        const h = canvas.height / window.devicePixelRatio;

        ctx.clearRect(0, 0, w, h);
        ctx.save();

        // Apply viewport transform
        ctx.translate(state.viewport.x, state.viewport.y);
        ctx.scale(state.viewport.zoom, state.viewport.zoom);

        // Draw grid
        drawGrid(w, h);

        // Draw edges
        for (const edge of state.workflow.edges) {
            drawEdge(edge);
        }

        // Draw creating edge (in progress)
        if (state.creatingEdge) {
            drawCreatingEdge();
        }

        // Draw nodes
        for (const node of state.workflow.nodes) {
            drawNode(node);
        }

        ctx.restore();
    }

    function drawGrid(w, h) {
        const gridSize = 20;
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.5;

        const startX = Math.floor(-state.viewport.x / state.viewport.zoom / gridSize) * gridSize;
        const startY = Math.floor(-state.viewport.y / state.viewport.zoom / gridSize) * gridSize;
        const endX = startX + (w / state.viewport.zoom) + gridSize * 2;
        const endY = startY + (h / state.viewport.zoom) + gridSize * 2;

        ctx.beginPath();
        for (let x = startX; x < endX; x += gridSize) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += gridSize) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();
    }

    function drawNode(node) {
        const config = NODE_CONFIGS[node.type] || NODE_CONFIGS.agent;
        const x = node.position.x;
        const y = node.position.y;
        const w = config.width;
        const h = config.height;

        // Determine color
        let color = config.color;
        if (state.executionStatus && state.executionStatus.nodeStatuses && state.executionStatus.nodeStatuses[node.id]) {
            const execRecord = state.executionStatus.nodeStatuses[node.id];
            color = STATUS_COLORS[execRecord.status] || config.color;
        }

        // Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Node body
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = color;
        ctx.lineWidth = state.selectedNodeIds.has(node.id) ? 3 : 2;
        roundRect(ctx, x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();

        // Reset shadow
        ctx.shadowColor = 'transparent';

        // Header bar
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + w - 8, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + 8);
        ctx.lineTo(x + w, y + h * 0.3);
        ctx.lineTo(x, y + h * 0.3);
        ctx.lineTo(x, y + 8);
        ctx.quadraticCurveTo(x, y, x + 8, y);
        ctx.fill();

        // Icon and label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(config.icon + ' ' + (node.data.label || config.label), x + w / 2, y + h * 0.3 + 14);

        // Sub-labels for agent nodes: agent name + model
        if (node.type === 'agent') {
            ctx.textAlign = 'center';
            const agentName = node.data.agent || 'unknown';
            const model = node.data.model || 'no model';
            ctx.fillStyle = '#666';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText(agentName.substring(0, 18), x + w / 2, y + h * 0.3 + 28);
            // Model name in a badge-like style
            ctx.fillStyle = '#2196F3';
            ctx.font = 'bold 10px system-ui, sans-serif';
            ctx.fillText(model.substring(0, 20), x + w / 2, y + h * 0.3 + 42);
        }

        // Ports
        drawPorts(node, x, y, w, h);
    }

    function drawPorts(node, x, y, w, h) {
        const portRadius = 5;

        // Output port (right side)
        if (node.type !== 'end') {
            ctx.fillStyle = '#4CAF50';
            ctx.beginPath();
            ctx.arc(x + w, y + h / 2, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Input port (left side)
        if (node.type !== 'start') {
            ctx.fillStyle = '#2196F3';
            ctx.beginPath();
            ctx.arc(x, y + h / 2, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Condition node has two output ports (True/False)
        if (node.type === 'condition') {
            // True port (top-right)
            ctx.fillStyle = '#4CAF50';
            ctx.beginPath();
            ctx.arc(x + w, y + 15, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#4CAF50';
            ctx.font = '9px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('True', x + w + 8, y + 18);

            // False port (bottom-right)
            ctx.fillStyle = '#f44336';
            ctx.beginPath();
            ctx.arc(x + w, y + h - 15, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#f44336';
            ctx.font = '9px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('False', x + w + 8, y + h - 12);
        }
    }

    function drawEdge(edge) {
        const sourceNode = state.workflow.nodes.find(n => n.id === edge.source);
        const targetNode = state.workflow.nodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        const config = NODE_CONFIGS[sourceNode.type];
        const sx = sourceNode.position.x + (config ? config.width : 140);
        const sy = sourceNode.position.y + (config ? config.height / 2 : 35);
        const tx = targetNode.position.x;
        const ty = targetNode.position.y + (NODE_CONFIGS[targetNode.type]?.height || 70) / 2;

        // Bezier curve
        const cp1x = sx + (tx - sx) * 0.5;
        const cp1y = sy;
        const cp2x = tx - (tx - sx) * 0.5;
        const cp2y = ty;

        ctx.strokeStyle = '#999';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(ty - cp2y, tx - cp2x);
        ctx.fillStyle = '#999';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 10 * Math.cos(angle - Math.PI / 6), ty - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(tx - 10 * Math.cos(angle + Math.PI / 6), ty - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        // Edge label
        if (edge.label) {
            const midX = (sx + tx) / 2;
            const midY = (sy + ty) / 2 - 8;
            ctx.fillStyle = '#666';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(edge.label, midX, midY);
        }
    }

    function drawCreatingEdge() {
        const { sourceNodeId, currentX, currentY } = state.creatingEdge;
        const sourceNode = state.workflow.nodes.find(n => n.id === sourceNodeId);
        if (!sourceNode) return;

        const config = NODE_CONFIGS[sourceNode.type];
        const sx = sourceNode.position.x + (config ? config.width : 140);
        const sy = sourceNode.position.y + (config ? config.height / 2 : 35);

        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ===== Mouse Events =====
    function onMouseDown(e) {
        const pos = getCanvasPosition(e);

// Check if clicking on an output port (start edge creation)
            const portHit = hitTestOutputPorts(pos);
        if (portHit) {
            state.creatingEdge = {
                sourceNodeId: portHit.nodeId,
                sourcePort: portHit.port,
                currentX: pos.x,
                currentY: pos.y
            };
            return;
        }

        // Check if clicking on a node
        const node = hitTestNodes(pos);
        if (node) {
            if (e.shiftKey) {
                // Toggle selection
                if (state.selectedNodeIds.has(node.id)) {
                    state.selectedNodeIds.delete(node.id);
                } else {
                    state.selectedNodeIds.add(node.id);
                }
            } else if (!state.selectedNodeIds.has(node.id)) {
                state.selectedNodeIds.clear();
                state.selectedNodeIds.add(node.id);
            }

            // Start dragging
            state.draggingNode = node.id;
            state.draggingOffset = {
                x: pos.x - node.position.x,
                y: pos.y - node.position.y
            };
            saveHistory();
            render();
            updatePropertiesPanel(node);
            return;
        }

        // Click on empty canvas - start panning or clear selection
        if (e.button === 1 || (e.button === 0 && state.selectedNodeIds.size === 0)) {
            state.panning = true;
            state.panStart = { x: e.clientX - state.viewport.x, y: e.clientY - state.viewport.y };
        } else {
            state.selectedNodeIds.clear();
            render();
            updatePropertiesPanel(null);
        }
    }

    function onMouseMove(e) {
        const pos = getCanvasPosition(e);

        if (state.creatingEdge) {
            state.creatingEdge.currentX = pos.x;
            state.creatingEdge.currentY = pos.y;
            render();
            return;
        }

        if (state.draggingNode) {
            const node = state.workflow.nodes.find(n => n.id === state.draggingNode);
            if (node) {
                node.position.x = Math.round((pos.x - state.draggingOffset.x) / 10) * 10;
                node.position.y = Math.round((pos.y - state.draggingOffset.y) / 10) * 10;
                render();
            }
            return;
        }

        if (state.panning) {
            state.viewport.x = e.clientX - state.panStart.x;
            state.viewport.y = e.clientY - state.panStart.y;
            render();
            return;
        }
    }

    function onMouseUp(e) {
        const pos = getCanvasPosition(e);

        if (state.creatingEdge) {
            // Check if we released on a valid input port
            const portHit = hitTestInputPorts(pos);
            if (portHit && portHit.nodeId !== state.creatingEdge.sourceNodeId) {
                const targetNode = state.workflow.nodes.find(n => n.id === portHit.nodeId);
                const sourceNode = state.workflow.nodes.find(n => n.id === state.creatingEdge.sourceNodeId);

                // Validate: can't connect to start's input or from end's output
                if (sourceNode && targetNode && targetNode.type !== 'start' && sourceNode.type !== 'end') {
                    // Check for duplicate edge
                    const exists = state.workflow.edges.some(
                        e => e.source === state.creatingEdge.sourceNodeId && e.target === portHit.nodeId
                    );
                    if (!exists) {
                        state.workflow.edges.push({
                            id: `${state.creatingEdge.sourceNodeId}->${portHit.nodeId}`,
                            source: state.creatingEdge.sourceNodeId,
                            target: portHit.nodeId,
                            label: portHit.port === 'true' ? 'True' : portHit.port === 'false' ? 'False' : ''
                        });
                        saveHistory();
                        notifyWorkflowUpdate();
                    }
                }
            }
            state.creatingEdge = null;
            render();
            return;
        }

        state.draggingNode = null;
        state.panning = false;
    }

    function onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.2, Math.min(3, state.viewport.zoom * delta));

        // Zoom towards mouse position
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        state.viewport.x = mx - (mx - state.viewport.x) * (newZoom / state.viewport.zoom);
        state.viewport.y = my - (my - state.viewport.y) * (newZoom / state.viewport.zoom);
        state.viewport.zoom = newZoom;

        render();
    }

    // ===== Keyboard Events =====
    function onKeyDown(e) {
        // Don't intercept keys when typing in an input or textarea
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (state.selectedNodeIds.size > 0) {
                deleteSelectedNodes();
                saveHistory();
                notifyWorkflowUpdate();
            }
        }

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            if (e.key === 'c') {
                // Copy
            }
            if (e.key === 'v') {
                // Paste
            }
            if (e.key === 's') {
                e.preventDefault();
                notifySave();
            }
        }

        if (e.key === 'Escape') {
            state.creatingEdge = null;
            state.selectedNodeIds.clear();
            render();
        }
    }

    // ===== Hit Testing =====
    function hitTestNodes(pos) {
        // Check in reverse order (top-most first)
        for (let i = state.workflow.nodes.length - 1; i >= 0; i--) {
            const node = state.workflow.nodes[i];
            const config = NODE_CONFIGS[node.type];
            if (!config) continue;

            if (pos.x >= node.position.x && pos.x <= node.position.x + config.width &&
                pos.y >= node.position.y && pos.y <= node.position.y + config.height) {
                return node;
            }
        }
        return null;
    }

    function hitTestPorts(pos) {
        for (const node of state.workflow.nodes) {
            const config = NODE_CONFIGS[node.type];
            if (!config) continue;

            const x = node.position.x;
            const y = node.position.y;
            const w = config.width;
            const h = config.height;

            // Output port (right)
            if (node.type !== 'end') {
                const dx = pos.x - (x + w);
                const dy = pos.y - (y + h / 2);
                if (dx * dx + dy * dy < 64) { // 8px radius hit area
                    return { nodeId: node.id, port: 'output' };
                }
            }

            // Input port (left)
            if (node.type !== 'start') {
                const dx = pos.x - x;
                const dy = pos.y - (y + h / 2);
                if (dx * dx + dy * dy < 64) {
                    return { nodeId: node.id, port: 'input' };
                }
            }

            // Condition node special ports
            if (node.type === 'condition') {
                // True port (top-right)
                const dx1 = pos.x - (x + w);
                const dy1 = pos.y - (y + 15);
                if (dx1 * dx1 + dy1 * dy1 < 64) {
                    return { nodeId: node.id, port: 'true' };
                }
                // False port (bottom-right)
                const dx2 = pos.x - (x + w);
                const dy2 = pos.y - (y + h - 15);
                if (dx2 * dx2 + dy2 * dy2 < 64) {
                    return { nodeId: node.id, port: 'false' };
                }
            }
        }
        return null;
    }

    function hitTestOutputPorts(pos) {
        for (const node of state.workflow.nodes) {
            const config = NODE_CONFIGS[node.type];
            if (!config) continue;

            const x = node.position.x;
            const y = node.position.y;
            const w = config.width;
            const h = config.height;

            // Condition node special output ports first
            if (node.type === 'condition') {
                // True port (top-right)
                const dx1 = pos.x - (x + w);
                const dy1 = pos.y - (y + 15);
                if (dx1 * dx1 + dy1 * dy1 < 64) {
                    return { nodeId: node.id, port: 'true' };
                }
                // False port (bottom-right)
                const dx2 = pos.x - (x + w);
                const dy2 = pos.y - (y + h - 15);
                if (dx2 * dx2 + dy2 * dy2 < 64) {
                    return { nodeId: node.id, port: 'false' };
                }
                continue; // Skip default output port for condition nodes
            }

            // Default output port (right)
            if (node.type !== 'end') {
                const dx = pos.x - (x + w);
                const dy = pos.y - (y + h / 2);
                if (dx * dx + dy * dy < 64) {
                    return { nodeId: node.id, port: 'output' };
                }
            }
        }
        return null;
    }

    function hitTestInputPorts(pos) {
        for (const node of state.workflow.nodes) {
            const config = NODE_CONFIGS[node.type];
            if (!config) continue;

            const x = node.position.x;
            const y = node.position.y;
            const w = config.width;
            const h = config.height;

            // Input port (left) — not for start nodes
            if (node.type !== 'start') {
                const dx = pos.x - x;
                const dy = pos.y - (y + h / 2);
                if (dx * dx + dy * dy < 64) {
                    return { nodeId: node.id, port: 'input' };
                }
            }
        }
        return null;
    }

    // ===== Toolbox =====
    function setupToolbox() {
        const items = document.querySelectorAll('.toolbox-item');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                (e as DragEvent).dataTransfer!.setData('nodeType', (item as HTMLElement).dataset!.type);
                (e as DragEvent).dataTransfer!.effectAllowed = 'copy';
            });
        });

        // Drop on canvas
        canvasContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvasContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('nodeType');
            if (!nodeType || !NODE_CONFIGS[nodeType]) return;

            // Check constraints
            if (nodeType === 'start' && state.workflow.nodes.some(n => n.type === 'start')) {
                vscode.postMessage({ type: 'showError', message: 'Workflow can only have one Start node' });
                return;
            }

            const pos = getCanvasPosition(e);
            const config = NODE_CONFIGS[nodeType];

            state.nodeCounter++;
            const node = {
                id: `${nodeType}_${state.nodeCounter}`,
                type: nodeType,
                position: {
                    x: Math.round((pos.x - config.width / 2) / 10) * 10,
                    y: Math.round((pos.y - config.height / 2) / 10) * 10
                },
                data: createDefaultNodeData(nodeType)
            };

            state.workflow.nodes.push(node);
            state.selectedNodeIds.clear();
            state.selectedNodeIds.add(node.id);
            saveHistory();
            render();
            updatePropertiesPanel(node);
            notifyWorkflowUpdate();
        });
    }

    function createDefaultNodeData(type) {
        switch (type) {
            case 'start': return { label: 'Start' };
            case 'end': return { label: 'End' };
            case 'agent': return { agent: '', prompt: '', timeout: 120, retries: 0 };
            case 'condition': return { expression: 'state.result === true' };
            case 'human_approval': return { message: 'Approve this step?' };
            case 'delay': return { duration: 5 };
            default: return {};
        }
    }

    // ===== Toolbar =====
    function setupToolbar() {
        document.getElementById('btn-save').addEventListener('click', () => notifySave());
        document.getElementById('btn-run').addEventListener('click', () => {
            document.getElementById('execution-panel').classList.remove('hidden');
            document.getElementById('execution-log').innerHTML = '';
            notifyRun();
        });
        document.getElementById('btn-pause').addEventListener('click', () => notifyPause());
        document.getElementById('btn-stop').addEventListener('click', () => notifyStop());
        document.getElementById('btn-resume').addEventListener('click', () => notifyResume());
        document.getElementById('btn-validate').addEventListener('click', () => notifyValidate());
        document.getElementById('btn-clear-log').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('execution-log').innerHTML = '';
        });
        // Toggle panel on header click
        document.querySelector('.panel-header').addEventListener('click', () => {
            document.getElementById('execution-panel').classList.toggle('hidden');
        });
    }

    // ===== Properties Panel =====
    function updatePropertiesPanel(node) {
        const content = document.getElementById('properties-content');

        if (!node) {
            content.innerHTML = '<p class="empty-state">Select a node to edit properties</p>';
            return;
        }

        let html = `<div class="property-section">
            <label>Node ID</label>
            <input type="text" value="${node.id}" readonly class="property-input readonly">
        </div>`;

        switch (node.type) {
            case 'start':
            case 'end':
                html += propertyField('Label', 'text', node.data.label || '');
                break;
            case 'agent':
                html += propertyField('Agent File', 'text', node.data.agent || '', 'e.g., planner');
                html += propertyField('Model', 'text', node.data.model || '', 'e.g., qwen3.6-27b');
                html += propertyField('Prompt', 'textarea', node.data.prompt || '');
                html += propertyField('Timeout (sec)', 'number', node.data.timeout || 120);
                html += propertyField('Retries', 'number', node.data.retries || 0);
                break;
            case 'condition':
                html += propertyField('Expression', 'textarea', node.data.expression || '', 'e.g., state.tests_passed === true');
                break;
            case 'human_approval':
                html += propertyField('Message', 'textarea', node.data.message || 'Approve this step?');
                break;
            case 'delay':
                html += propertyField('Duration (sec)', 'number', node.data.duration || 5);
                break;
        }

        html += `<button class="delete-node-btn" onclick="deleteSelectedNodes()">Delete Node</button>`;
        content.innerHTML = html;

        // Bind events
        content.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('change', (e) => {
                const target = e.target as HTMLElement;
                const label = target.closest('.property-section')!.querySelector('label')!.textContent;
                updateNodeProperty(node, label, (target as HTMLInputElement).value);
            });
        });
    }

    function escapeHtml(str) {
        const s = String(str ?? '');
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function propertyField(label, type, value, placeholder?) {
        const escValue = escapeHtml(value);
        const escPlaceholder = escapeHtml(placeholder || '');
        const escLabel = escapeHtml(label);
        const inputHtml = type === 'textarea'
            ? `<textarea class="property-input" placeholder="${escPlaceholder}">${escValue}</textarea>`
            : `<input type="${type}" value="${escValue}" class="property-input" placeholder="${escPlaceholder}">`;

        return `<div class="property-section">
            <label>${escLabel}</label>
            ${inputHtml}
        </div>`;
    }

    function updateNodeProperty(node, label, value) {
        const keyMap = {
            'Label': 'label',
            'Agent File': 'agent',
            'Model': 'model',
            'Prompt': 'prompt',
            'Timeout (sec)': 'timeout',
            'Retries': 'retries',
            'Expression': 'expression',
            'Message': 'message',
            'Duration (sec)': 'duration'
        };

        const key = keyMap[label];
        if (!key) return;

        if (label.includes('sec') || label.includes('Retries')) {
            node.data[key] = parseInt(value) || 0;
        } else {
            node.data[key] = value;
        }

        saveHistory();
        render();
        notifyWorkflowUpdate();
    }

    // ===== Node Operations =====
    function deleteSelectedNodes() {
        const ids = Array.from(state.selectedNodeIds);
        state.workflow.nodes = state.workflow.nodes.filter(n => !ids.includes(n.id));
        state.workflow.edges = state.workflow.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target));
        state.selectedNodeIds.clear();
        render();
        updatePropertiesPanel(null);
    }

    // Make it globally accessible for onclick
    window.deleteSelectedNodes = deleteSelectedNodes;

    // ===== History (Undo/Redo) =====
    function saveHistory() {
        const snapshot = JSON.stringify(state.workflow);
        // Remove future states if we're not at the end
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(snapshot);
        state.historyIndex = state.history.length - 1;

        // Limit history size
        if (state.history.length > 50) {
            state.history.shift();
            state.historyIndex--;
        }
    }

    function undo() {
        if (state.historyIndex > 0) {
            state.historyIndex--;
            state.workflow = JSON.parse(state.history[state.historyIndex]);
            state.selectedNodeIds.clear();
            render();
            updatePropertiesPanel(null);
            notifyWorkflowUpdate();
        }
    }

    function redo() {
        if (state.historyIndex < state.history.length - 1) {
            state.historyIndex++;
            state.workflow = JSON.parse(state.history[state.historyIndex]);
            state.selectedNodeIds.clear();
            render();
            updatePropertiesPanel(null);
            notifyWorkflowUpdate();
        }
    }

    // ===== VS Code Communication =====
    function onMessage(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'init':
                state.workflow = msg.workflow;
                // Initialize node counter
                for (const node of state.workflow.nodes) {
                    const match = node.id.match(/_(\d+)$/);
                    if (match) {
                        state.nodeCounter = Math.max(state.nodeCounter, parseInt(match[1]));
                    }
                }
                saveHistory();
                render();
                break;
            case 'executionUpdate':
                state.executionStatus = msg.status;
                render();
                updateExecutionStatusUI(msg.status);
                // Show execution panel when running
                if (msg.status && (msg.status.overall === 'running' || msg.status.overall === 'paused')) {
                    document.getElementById('execution-panel').classList.remove('hidden');
                }
                if (msg.status && (msg.status.overall === 'completed' || msg.status.overall === 'failed' || msg.status.overall === 'stopped')) {
                    document.getElementById('execution-panel').classList.remove('hidden');
                }
                break;
            case 'logMessage':
                addLogMessage(msg.message);
                break;
            case 'validationResult':
                if (msg.errors && msg.errors.length > 0) {
                    vscode.postMessage({ type: 'showError', message: msg.errors.map(e => e.message).join('\n') });
                } else {
                    vscode.postMessage({ type: 'showInfo', message: 'Workflow is valid!' });
                }
                break;
            case 'showError':
                // No-op: error already shown by extension host
                break;
            case 'showInfo':
                // No-op: info already shown by extension host
                break;
        }
    }

    function notifyWorkflowUpdate() {
        vscode.postMessage({
            type: 'updateWorkflow',
            workflow: state.workflow
        });
        // Update VS Code state for title dirty indicator
        vscode.setState(state.workflow);
    }

    function notifySave() {
        vscode.postMessage({ type: 'save' });
    }

    function notifyRun() {
        vscode.postMessage({ type: 'run' });
    }

    function notifyPause() {
        vscode.postMessage({ type: 'pause' });
    }

    function notifyStop() {
        vscode.postMessage({ type: 'stop' });
    }

    function notifyResume() {
        vscode.postMessage({ type: 'resume' });
    }

    function notifyValidate() {
        vscode.postMessage({ type: 'validate', workflow: state.workflow });
    }

    function updateExecutionStatusUI(status) {
        const badge = document.getElementById('execution-status');
        if (!status) {
            badge.textContent = '';
            badge.className = 'status-badge';
            return;
        }

        badge.textContent = status.overall || '';
        badge.className = 'status-badge';

        if (status.overall === 'running') badge.classList.add('running');
        if (status.overall === 'completed') badge.classList.add('completed');
        if (status.overall === 'failed') badge.classList.add('failed');
        if (status.overall === 'paused') badge.classList.add('paused');
    }

    function addLogMessage(message) {
        const logEl = document.getElementById('execution-log');
        const line = document.createElement('div');
        line.className = 'log-line';
        if (message.includes('✗') || message.includes('failed') || message.includes('error')) {
            line.classList.add('error');
        } else if (message.includes('✓') || message.includes('completed') || message.includes('success')) {
            line.classList.add('success');
        } else if (message.includes('▶') || message.includes('Starting')) {
            line.classList.add('info');
        }
        line.textContent = message;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    }

    // ===== Utilities =====
    function getCanvasPosition(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - state.viewport.x) / state.viewport.zoom,
            y: (e.clientY - rect.top - state.viewport.y) / state.viewport.zoom
        };
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ===== Start =====
    init();
})();
