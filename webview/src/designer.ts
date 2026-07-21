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
        historyIndex: -1,
        agentFiles: [] as string[],
        editMode: false,
        // Edge animation state
        animationFrameId: null as number | null,
        animationTime: 0,
        // Edge label editing state
        editingEdgeId: null as string | null,
        // Edge selection state
        selectedEdgeId: null as string | null,
        // Selection box state
        selectionBox: null as { startX: number; startY: number; endX: number; endY: number } | null,
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

    // ===== Theme Colors (read from VS Code CSS variables) =====
    let themeColors: Record<string, string> = {};

    function resolveThemeColors(): void {
        const styles = getComputedStyle(document.body);
        const get = (name: string) => styles.getPropertyValue(name).trim() || '';
        themeColors = {
            editorBackground: get('--vscode-editor-background') || '#1e1e1e',
            sideBarBackground: get('--vscode-sideBar-background') || '#252526',
            foreground: get('--vscode-foreground') || '#cccccc',
            descriptionForeground: get('--vscode-descriptionForeground') || '#858585',
            inputBackground: get('--vscode-input-background') || '#3c3c3c',
            inputForeground: get('--vscode-input-foreground') || '#cccccc',
            inputBorder: get('--vscode-input-border') || '#3c3c3c',
            focusBorder: get('--vscode-focusBorder') || '#007fd4',
            listHoverBackground: get('--vscode-list-hoverBackground') || '#2a2d2e',
            listActiveSelectionBackground: get('--vscode-list-activeSelectionBackground') || '#094771',
            buttonBackground: get('--vscode-button-background') || '#0e639c',
            buttonForeground: get('--vscode-button-foreground') || '#ffffff',
            buttonHoverBackground: get('--vscode-button-hoverBackground') || '#1177bb',
            buttonSecondaryBackground: get('--vscode-button-secondaryBackground') || '#3a3d41',
            buttonSecondaryForeground: get('--vscode-button-secondaryForeground') || '#cccccc',
            toolbarBackground: get('--vscode-toolbar-background') || '#2c2c2c',
            panelBorder: get('--vscode-panel-border') || '#505050',
            scrollbarSliderBackground: get('--vscode-scrollbarSlider-background') || '#424242',
            scrollbarSliderHoverBackground: get('--vscode-scrollbarSlider-hoverBackground') || '#525252',
        };
    }

    function getThemeColor(name: string): string {
        return themeColors[name] || '#cccccc';
    }

    /** Parse a hex color and return its relative luminance (0=black, 1=white). */
    function parseLuminance(hex: string): number {
        const cleaned = hex.replace('#', '');
        if (cleaned.length === 3) {
            const r = parseInt(cleaned[0] + cleaned[0], 16) / 255;
            const g = parseInt(cleaned[1] + cleaned[1], 16) / 255;
            const b = parseInt(cleaned[2] + cleaned[2], 16) / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        if (cleaned.length === 6) {
            const r = parseInt(cleaned.substring(0, 2), 16) / 255;
            const g = parseInt(cleaned.substring(2, 4), 16) / 255;
            const b = parseInt(cleaned.substring(4, 6), 16) / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        return 1; // default to "light" if unparseable
    }

    /** Determine if the current theme is dark based on editor background luminance. */
    function isDarkTheme(): boolean {
        const bg = getThemeColor('editorBackground');
        return parseLuminance(bg) < 0.5;
    }

    // ===== Initialization =====
    function init() {
        console.log('[Designer] init() called');

        // Resolve VS Code theme colors
        resolveThemeColors();

        window.addEventListener('resize', resizeCanvas);

        // Canvas events
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('dblclick', onDoubleClick);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Keyboard events
        document.addEventListener('keydown', onKeyDown);

        // Toolbox drag events
        setupToolbox();

        // Toolbar events
        setupToolbar();

        // Apply initial edit mode (OFF / read-only)
        applyInitialEditMode();

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

        // Draw selection box
        drawSelectionBox();

        ctx.restore();
    }

    function drawGrid(w, h) {
        const gridSize = 20;
        const gridColor = isDarkTheme()
            ? 'rgba(255, 255, 255, 0.06)'
            : 'rgba(0, 0, 0, 0.08)';
        ctx.strokeStyle = gridColor;
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
        ctx.fillStyle = getThemeColor('inputBackground');
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
            ctx.fillStyle = getThemeColor('descriptionForeground');
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

        // Bezier curve control points
        const cp1x = sx + (tx - sx) * 0.5;
        const cp1y = sy;
        const cp2x = tx - (tx - sx) * 0.5;
        const cp2y = ty;

        // Check if target node is running (for animation)
        const isTargetRunning = state.executionStatus
            && state.executionStatus.nodeStatuses
            && state.executionStatus.nodeStatuses[edge.target]
            && state.executionStatus.nodeStatuses[edge.target].status === 'running';

        // Determine if this edge is selected
        const isSelected = state.selectedEdgeId === edge.id;

        // Set styles based on selection and animation state
        if (isSelected) {
            ctx.strokeStyle = getThemeColor('focusBorder');
            ctx.lineWidth = 4;
        } else {
            ctx.strokeStyle = getThemeColor('descriptionForeground');
            ctx.lineWidth = 2;
        }

        // Animate with dashed line if target is running
        if (isTargetRunning) {
            ctx.setLineDash([8, 4]);
            ctx.lineDashOffset = -state.animationTime;
        } else {
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
        ctx.stroke();

        // Reset dash
        ctx.setLineDash([]);

        // Arrow head
        const angle = Math.atan2(ty - cp2y, tx - cp2x);
        ctx.fillStyle = isSelected ? getThemeColor('focusBorder') : getThemeColor('descriptionForeground');
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 10 * Math.cos(angle - Math.PI / 6), ty - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(tx - 10 * Math.cos(angle + Math.PI / 6), ty - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        // Edge label
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2 - 8;
        if (edge.label) {
            // Draw label background for readability
            ctx.font = '10px system-ui';
            const metrics = ctx.measureText(edge.label);
            const padding = 4;
            const bgX = midX - metrics.width / 2 - padding;
            const bgY = midY - 10;
            const bgW = metrics.width + padding * 2;
            const bgH = 14;

            ctx.fillStyle = isDarkTheme() ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)';
            ctx.fillRect(bgX, bgY, bgW, bgH);

            ctx.fillStyle = isSelected ? getThemeColor('focusBorder') : getThemeColor('descriptionForeground');
            ctx.textAlign = 'center';
            ctx.fillText(edge.label, midX, midY);
        } else {
            // Draw empty label background hint when selected (for editing hint)
            if (isSelected) {
                ctx.fillStyle = isDarkTheme() ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)';
                const hint = 'double-click to edit';
                ctx.font = '10px system-ui';
                const metrics = ctx.measureText(hint);
                const padding = 4;
                const bgX = midX - metrics.width / 2 - padding;
                const bgY = midY - 10;
                const bgW = metrics.width + padding * 2;
                const bgH = 14;
                ctx.fillRect(bgX, bgY, bgW, bgH);
                ctx.fillStyle = getThemeColor('focusBorder');
                ctx.textAlign = 'center';
                ctx.fillText(hint, midX, midY);
            }
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

        // Check if clicking on an output port (start edge creation) — edit mode only
        if (state.editMode) {
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
        }

        // Check if clicking on an edge (for selection) — edit mode only
        if (state.editMode) {
            const edgeHit = hitTestEdges(pos);
            if (edgeHit) {
                if (e.shiftKey) {
                    // Toggle edge selection (deselect if already selected)
                    if (state.selectedEdgeId === edgeHit.id) {
                        state.selectedEdgeId = null;
                    } else {
                        state.selectedEdgeId = edgeHit.id;
                        state.selectedNodeIds.clear();
                    }
                } else {
                    // Select edge, deselect nodes
                    state.selectedEdgeId = edgeHit.id;
                    state.selectedNodeIds.clear();
                }
                render();
                return;
            }
        }

        // Check if clicking on a node
        const node = hitTestNodes(pos);
        if (node) {
            if (state.editMode) {
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

                // Start dragging — edit mode only
                state.draggingNode = node.id;
                state.draggingOffset = {
                    x: pos.x - node.position.x,
                    y: pos.y - node.position.y
                };
                saveHistory();
                render();
                updatePropertiesPanel(node);
            } else {
                // View mode: just select for visual feedback, no dragging
                state.selectedNodeIds.clear();
                state.selectedNodeIds.add(node.id);
                render();
            }
            return;
        }

        // Click on empty canvas - start panning, selection box, or clear selection
        if (e.button === 1) {
            // Middle mouse: always pan
            state.panning = true;
            state.panStart = { x: e.clientX - state.viewport.x, y: e.clientY - state.viewport.y };
        } else if (state.editMode && state.selectedNodeIds.size === 0 && !state.selectedEdgeId) {
            // Left click on empty canvas in edit mode: start selection box
            state.selectionBox = {
                startX: pos.x,
                startY: pos.y,
                endX: pos.x,
                endY: pos.y,
            };
        } else if (state.selectedNodeIds.size === 0 && !state.selectedEdgeId) {
            // Left click on empty canvas in view mode: pan
            state.panning = true;
            state.panStart = { x: e.clientX - state.viewport.x, y: e.clientY - state.viewport.y };
        } else {
            state.selectedNodeIds.clear();
            state.selectedEdgeId = null;
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

        if (state.draggingNode && state.editMode) {
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

        if (state.selectionBox) {
            state.selectionBox.endX = pos.x;
            state.selectionBox.endY = pos.y;
            render();
            return;
        }
    }

    function onMouseUp(e) {
        const pos = getCanvasPosition(e);

        if (state.creatingEdge && state.editMode) {
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

        // Finalize selection box
        if (state.selectionBox) {
            const box = state.selectionBox;
            const nodeIds = nodesInRect(box.startX, box.startY, box.endX, box.endY);

            if (nodeIds.length > 0 || Math.abs(box.endX - box.startX) > 3 || Math.abs(box.endY - box.startY) > 3) {
                if (e.shiftKey) {
                    // Shift+drag: add to existing selection
                    for (const id of nodeIds) {
                        state.selectedNodeIds.add(id);
                    }
                } else {
                    // Replace selection
                    state.selectedNodeIds.clear();
                    for (const id of nodeIds) {
                        state.selectedNodeIds.add(id);
                    }
                }
                updatePropertiesPanel(state.selectedNodeIds.size === 1 ? state.workflow.nodes.find(n => n.id === Array.from(state.selectedNodeIds).pop()) : null);
            }

            state.selectionBox = null;
            render();
        }
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

        if ((e.key === 'Delete' || e.key === 'Backspace') && state.editMode) {
            if (state.selectedNodeIds.size > 0) {
                deleteSelectedNodes();
                saveHistory();
                notifyWorkflowUpdate();
            } else if (state.selectedEdgeId) {
                deleteSelectedEdge();
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
            state.selectedEdgeId = null;
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

    /**
     * Hit test for edges using distance from point to cubic Bezier curve.
     * Returns the edge if the click is within a threshold distance of the curve.
     */
    function hitTestEdges(pos) {
        const threshold = 10; // pixels

        for (const edge of state.workflow.edges) {
            const sourceNode = state.workflow.nodes.find(n => n.id === edge.source);
            const targetNode = state.workflow.nodes.find(n => n.id === edge.target);
            if (!sourceNode || !targetNode) continue;

            const config = NODE_CONFIGS[sourceNode.type];
            const sx = sourceNode.position.x + (config ? config.width : 140);
            const sy = sourceNode.position.y + (config ? config.height / 2 : 35);
            const tx = targetNode.position.x;
            const ty = targetNode.position.y + (NODE_CONFIGS[targetNode.type]?.height || 70) / 2;

            // Bezier control points
            const cp1x = sx + (tx - sx) * 0.5;
            const cp1y = sy;
            const cp2x = tx - (tx - sx) * 0.5;
            const cp2y = ty;

            const minDist = distanceToCubicBezier(pos.x, pos.y, sx, sy, cp1x, cp1y, cp2x, cp2y, tx, ty);
            if (minDist < threshold) {
                return edge;
            }
        }
        return null;
    }

    /**
     * Calculate minimum distance from a point to a cubic Bezier curve.
     * Uses sampling approach for accuracy.
     */
    function distanceToCubicBezier(px, py, sx, sy, cp1x, cp1y, cp2x, cp2y, ex, ey) {
        let minDist = Infinity;
        const samples = 50;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const x = bezierPoint(sx, cp1x, cp2x, ex, t);
            const y = bezierPoint(sy, cp1y, cp2y, ey, t);
            const dx = px - x;
            const dy = py - y;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
                minDist = dist;
            }
        }

        return Math.sqrt(minDist);
    }

    /**
     * Calculate a point on a cubic Bezier curve at parameter t.
     */
    function bezierPoint(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
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

            // Drop nodes only in edit mode
            if (!state.editMode) return;

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
        document.getElementById('btn-run').addEventListener('click', () => notifyRun());
        document.getElementById('btn-pause').addEventListener('click', () => notifyPause());
        document.getElementById('btn-stop').addEventListener('click', () => notifyStop());
        document.getElementById('btn-resume').addEventListener('click', () => notifyResume());
        document.getElementById('btn-validate').addEventListener('click', () => notifyValidate());
        document.getElementById('btn-edit-mode').addEventListener('click', () => toggleEditMode());
    }

    // ===== Edit Mode =====
    function toggleEditMode() {
        state.editMode = !state.editMode;
        const toolbox = document.getElementById('toolbox');
        const propertiesPanel = document.getElementById('properties-panel');
        const btn = document.getElementById('btn-edit-mode');

        if (state.editMode) {
            // Edit mode ON — show panels, enable editing
            toolbox.classList.remove('hidden');
            propertiesPanel.classList.remove('hidden');
            btn.classList.add('active');
            btn.textContent = '✎ Edit';
        } else {
            // Edit mode OFF — hide panels, read-only canvas
            toolbox.classList.add('hidden');
            propertiesPanel.classList.add('hidden');
            btn.classList.remove('active');
            btn.textContent = '✎ Edit';
        }

        // Resize canvas after panels slide in/out
        setTimeout(() => resizeCanvas(), 250);
    }

    // Apply initial edit mode state (default: OFF / read-only)
    function applyInitialEditMode() {
        const toolbox = document.getElementById('toolbox');
        const propertiesPanel = document.getElementById('properties-panel');
        if (toolbox) toolbox.classList.add('hidden');
        if (propertiesPanel) propertiesPanel.classList.add('hidden');
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
            <input type="text" value="${escapeHtml(node.id)}" readonly class="property-input readonly">
        </div>`;

        switch (node.type) {
            case 'start':
            case 'end':
                html += propertyField('Label', 'text', node.data.label || '');
                break;
            case 'agent':
                html += propertySelectField('Agent File', node.data.agent || '', state.agentFiles);
                html += propertyField('Model', 'text', node.data.model || '', 'e.g., Claude Sonnet 4.6 (copilot)');
                html += propertyField('Prompt', 'textarea', node.data.prompt || '');
                html += propertyField('Description', 'textarea', node.data.description || '', 'Optional description of what this agent does');
                html += propertyField('Timeout (sec)', 'number', node.data.timeout || 120);
                html += propertyField('Retries', 'number', node.data.retries || 0);
                html += renderStateMappings(node);
                break;
            case 'condition':
                html += propertyField('Expression', 'textarea', node.data.expression || '', 'e.g., state.tests_passed === true');
                html += propertyField('Description', 'textarea', node.data.description || '', 'Optional description of this condition');
                break;
            case 'human_approval':
                html += propertyField('Message', 'textarea', node.data.message || 'Approve this step?');
                html += propertyField('Description', 'textarea', node.data.description || '', 'Optional description of this approval step');
                break;
            case 'delay':
                html += propertyField('Duration (sec)', 'number', node.data.duration || 5);
                html += propertyField('Description', 'textarea', node.data.description || '', 'Optional description of this delay');
                break;
        }

        html += `<button class="delete-node-btn" onclick="deleteSelectedNodes()">Delete Node</button>`;
        content.innerHTML = html;

        // Bind events
        content.querySelectorAll('input, textarea, select').forEach(input => {
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

    function propertySelectField(label, value, options) {
        const escLabel = escapeHtml(label);
        const escValue = escapeHtml(value);
        let optionsHtml = '<option value="">Select...</option>';
        for (const opt of options) {
            const escOpt = escapeHtml(opt);
            const selected = opt === value ? 'selected' : '';
            optionsHtml += `<option value="${escOpt}" ${selected}>${escOpt}</option>`;
        }
        return `<div class="property-section">
            <label>${escLabel}</label>
            <select class="property-input">${optionsHtml}</select>
        </div>`;
    }

    // ===== State Mappings UI =====
    function renderStateMappings(node) {
        const mappings = (node.data as any).stateWrites || [];
        let html = `<div class="property-section">
            <label>State Mappings</label>
            <div class="mappings-list">`;

        if (mappings.length === 0) {
            html += '<div class="mappings-empty">No mappings configured</div>';
        } else {
            mappings.forEach((mapping, idx) => {
                html += `<div class="mapping-entry">
                    <div class="mapping-display">
                        <span class="mapping-source">${escapeHtml(mapping.source)}</span>
                        <span class="mapping-arrow">→</span>
                        <span class="mapping-target">${escapeHtml(mapping.target)}</span>
                    </div>
                    <div class="mapping-edit">
                        <input type="text" class="mapping-input" placeholder="source (e.g. json.plan)" value="${escapeHtml(mapping.source)}"
                            onchange="updateMappingSource(${idx}, this.value)">
                        <input type="text" class="mapping-input" placeholder="target state key" value="${escapeHtml(mapping.target)}"
                            onchange="updateMappingTarget(${idx}, this.value)">
                    </div>
                    <button class="mapping-remove-btn" onclick="removeMapping(${idx})">✕</button>
                </div>`;
            });
        }

        html += `</div>
            <button class="add-mapping-btn" onclick="addMapping()">+ Add Mapping</button>
        </div>`;
        return html;
    }

    function addMapping() {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'agent') return;

        if (!node.data.stateWrites) {
            node.data.stateWrites = [];
        }
        node.data.stateWrites.push({ source: '', target: '' });

        saveHistory();
        render();
        updatePropertiesPanel(node);
        notifyWorkflowUpdate();
    }

    function removeMapping(index) {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'agent') return;
        if (!node.data.stateWrites) return;

        node.data.stateWrites = node.data.stateWrites.filter((_, i) => i !== index);

        saveHistory();
        render();
        updatePropertiesPanel(node);
        notifyWorkflowUpdate();
    }

    function updateMappingSource(index, value) {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'agent') return;
        if (!node.data.stateWrites) return;
        if (!node.data.stateWrites[index]) return;

        node.data.stateWrites[index].source = value;

        saveHistory();
        render();
        notifyWorkflowUpdate();
    }

    function updateMappingTarget(index, value) {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'agent') return;
        if (!node.data.stateWrites) return;
        if (!node.data.stateWrites[index]) return;

        node.data.stateWrites[index].target = value;

        saveHistory();
        render();
        notifyWorkflowUpdate();
    }

    // Expose mapping functions globally for onclick handlers
    (window as any).addMapping = addMapping;
    (window as any).removeMapping = removeMapping;
    (window as any).updateMappingSource = updateMappingSource;
    (window as any).updateMappingTarget = updateMappingTarget;

    function updateNodeProperty(node, label, value) {
        const keyMap = {
            'Label': 'label',
            'Agent File': 'agent',
            'Model': 'model',
            'Prompt': 'prompt',
            'Description': 'description',
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

    // ===== Edge Operations =====
    function deleteSelectedEdge() {
        if (!state.selectedEdgeId) return;
        state.workflow.edges = state.workflow.edges.filter(e => e.id !== state.selectedEdgeId);
        state.selectedEdgeId = null;
        render();
    }

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
                state.agentFiles = msg.agentFiles || [];
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
            case 'themeColor':
            case 'vscode:theme-color':
                // VS Code sends this when the user switches themes (dark ↔ light)
                resolveThemeColors();
                render();
                break;
            case 'executionUpdate':
                state.executionStatus = msg.status;
                render();
                updateExecutionStatusUI(msg.status);
                break;
            case 'logMessage':
                // No-op: logs go to VS Code Output Channel
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
            case 'edgeLabelUpdate':
                // Extension host returned the new label
                const edge = state.workflow.edges.find(e => e.id === msg.edgeId);
                if (edge) {
                    edge.label = msg.newLabel;
                    state.editingEdgeId = null;
                    saveHistory();
                    render();
                    notifyWorkflowUpdate();
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

    // ===== Selection Box =====
    function drawSelectionBox() {
        if (!state.selectionBox) return;
        const box = state.selectionBox;
        const x = Math.min(box.startX, box.endX);
        const y = Math.min(box.startY, box.endY);
        const w = Math.abs(box.endX - box.startX);
        const h = Math.abs(box.endY - box.startY);

        ctx.fillStyle = isDarkTheme() ? 'rgba(0, 120, 215, 0.15)' : 'rgba(0, 120, 215, 0.12)';
        ctx.strokeStyle = getThemeColor('focusBorder') || '#0078d5';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    }

    function nodesInRect(x1, y1, x2, y2) {
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);
        const maxX = Math.max(x1, x2);
        const maxY = Math.max(y1, y2);

        const result = [];
        for (const node of state.workflow.nodes) {
            const config = NODE_CONFIGS[node.type];
            const nw = config ? config.width : 140;
            const nh = config ? config.height : 70;
            const nx = node.position.x;
            const ny = node.position.y;

            // Check if node rectangle intersects selection rectangle
            if (nx < maxX && nx + nw > minX && ny < maxY && ny + nh > minY) {
                result.push(node.id);
            }
        }
        return result;
    }

    // ===== Animation Loop =====
    function startAnimationLoop() {
        if (state.animationFrameId) return; // Already running
        animate();
    }

    function animate() {
        state.animationFrameId = requestAnimationFrame(() => {
            state.animationTime += 0.5; // Speed of dash animation
            render();
            animate();
        });
    }

    // ===== Double Click Handler =====
    function onDoubleClick(e) {
        if (!state.editMode) return;

        const pos = getCanvasPosition(e);
        const edgeHit = hitTestEdges(pos);
        if (edgeHit) {
            // Request label edit from extension host
            vscode.postMessage({
                type: 'editEdgeLabel',
                edgeId: edgeHit.id,
                currentLabel: edgeHit.label || ''
            });
            state.editingEdgeId = edgeHit.id;
        }
    }

    // ===== Start =====
    init();
    // Start animation loop for edge flow animation
    startAnimationLoop();
})();
