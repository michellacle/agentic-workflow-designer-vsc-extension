/**
 * Workflow Designer - Webview JavaScript
 * Canvas-based visual workflow editor
 */

(function () {
    'use strict';

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
    const vscode = acquireVsCodeApi();

    // ===== Canvas Setup =====
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const canvasContainer = document.getElementById('canvas-container');

    // ===== Node Configurations =====
    const NODE_CONFIGS = {
        start: { label: 'Start', color: '#4CAF50', width: 120, height: 50, icon: '●' },
        end: { label: 'End', color: '#f44336', width: 120, height: 50, icon: '●' },
        agent: { label: 'Agent', color: '#2196F3', width: 140, height: 70, icon: '🤖' },
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
        resizeCanvas();
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

        // Initial render
        render();
    }

    // ===== Canvas Resize =====
    function resizeCanvas() {
        const rect = canvasContainer.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
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
            const execStatus = state.executionStatus.nodeStatuses[node.id];
            color = STATUS_COLORS[execStatus] || config.color;
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

        // Sub-label for agent nodes
        if (node.type === 'agent' && node.data.agent) {
            ctx.fillStyle = '#666';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText(node.data.agent.substring(0, 15), x + w / 2, y + h * 0.3 + 28);
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

        // Check if clicking on a port (start edge creation)
        const portHit = hitTestPorts(pos);
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
            const portHit = hitTestPorts(pos);
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

    // ===== Toolbox =====
    function setupToolbox() {
        const items = document.querySelectorAll('.toolbox-item');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('nodeType', item.dataset.type);
                e.dataTransfer.effectAllowed = 'copy';
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
                vscode.window.showErrorMessage('Workflow can only have one Start node');
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
        document.getElementById('btn-run').addEventListener('click', () => notifyRun());
        document.getElementById('btn-pause').addEventListener('click', () => notifyPause());
        document.getElementById('btn-stop').addEventListener('click', () => notifyStop());
        document.getElementById('btn-resume').addEventListener('click', () => notifyResume());
        document.getElementById('btn-validate').addEventListener('click', () => notifyValidate());
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
                const label = e.target.closest('.property-section').querySelector('label').textContent;
                updateNodeProperty(node, label, e.target.value);
            });
        });
    }

    function propertyField(label, type, value, placeholder) {
        const inputHtml = type === 'textarea'
            ? `<textarea class="property-input" placeholder="${placeholder || ''}">${value}</textarea>`
            : `<input type="${type}" value="${value}" class="property-input" placeholder="${placeholder || ''}">`;

        return `<div class="property-section">
            <label>${label}</label>
            ${inputHtml}
        </div>`;
    }

    function updateNodeProperty(node, label, value) {
        const keyMap = {
            'Label': 'label',
            'Agent File': 'agent',
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
            render();
            notifyWorkflowUpdate();
        }
    }

    function redo() {
        if (state.historyIndex < state.history.length - 1) {
            state.historyIndex++;
            state.workflow = JSON.parse(state.history[state.historyIndex]);
            render();
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
                break;
            case 'validationResult':
                if (msg.errors && msg.errors.length > 0) {
                    vscode.postMessage({ type: 'error', message: msg.errors.map(e => e.message).join('\n') });
                } else {
                    vscode.postMessage({ type: 'info', message: 'Workflow is valid!' });
                }
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
