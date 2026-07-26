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
        animationConfig: {
            startNodeFlashMs: 3000,
            edgeHandoffMs: 3000,
            endNodeFlashMs: 1200,
            edgeDashSpeed: 20,
        },
        nowMs: performance.now(),
        edgeAnimations: {} as Record<string, { startTime: number; endTime: number }>,
        nodeAnimations: {} as Record<string, { mode: 'pulse' | 'flash'; endTime?: number }>,
        pendingNodePulses: {} as Record<string, number>,
        previousNodeStatuses: {} as Record<string, string>,
        previousCurrentNodeId: null as string | null,
        previousOverallStatus: null as string | null,
        // Edge label editing state
        editingEdgeId: null as string | null,
        // Edge selection state
        selectedEdgeId: null as string | null,
        // Per-node execution counts (how many times each node has been entered)
        nodeExecutionCounts: {} as Record<string, number>,
    };

    // Port dragging state
    let draggingPort = null as {
        edgeId: string;
        side: 'source' | 'target';
        nodeId: string;
    } | null;

    // Track last mouse position for hover effects
    let lastMouseCanvasPos = null as { x: number; y: number } | null;

    // ===== VS Code API =====
    let vscode: any;
    try {
        vscode = acquireVsCodeApi();
    } catch (e: any) {
        showError('Failed to acquire VS Code API: ' + e.message);
        return;
    }

    // ===== Canvas Setup =====
    // ===== Canvas Setup =====
    function getPortPosition(node, side) {
        const config = NODE_CONFIGS[node.type];
        const w = config ? config.width : 140;
        const h = config ? config.height : 70;
        const x = node.position.x;
        const y = node.position.y;
        switch (side) {
            case 'top': return { x: x + w / 2, y: y };
            case 'right': return { x: x + w, y: y + h / 2 };
            case 'bottom': return { x: x + w / 2, y: y + h };
            case 'left': return { x: x, y: y + h / 2 };
            default: return { x: x + w, y: y + h / 2 };
        }
    }

    function getCanvasPositionFromLastEvent() {
        return lastMouseCanvasPos;
    }

    function snapSideToBorder(node, canvasPos) {
        const config = NODE_CONFIGS[node.type];
        const w = config ? config.width : 140;
        const h = config ? config.height : 70;
        const x = node.position.x;
        const y = node.position.y;

        // Snap by nearest border line in node-local space.
        // This avoids opposite-side flips when dragging around corners.
        const localX = canvasPos.x - x;
        const localY = canvasPos.y - y;
        const distTop = Math.abs(localY);
        const distBottom = Math.abs(h - localY);
        const distLeft = Math.abs(localX);
        const distRight = Math.abs(w - localX);

        const min = Math.min(distTop, distBottom, distLeft, distRight);
        if (min === distTop) return 'top';
        if (min === distBottom) return 'bottom';
        if (min === distLeft) return 'left';
        return 'right';
    }

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
        start: { label: 'Start', color: '#4CAF50', width: 108, height: 45, icon: '●' },
        end: { label: 'End', color: '#f44336', width: 108, height: 45, icon: '●' },
        agent: { label: 'Agent', color: '#2196F3', width: 140, height: 90, icon: '🤖' },
        condition: { label: 'Condition', color: '#FF9800', width: 140, height: 140, icon: '◇' },
        human_approval: { label: 'Approval', color: '#9C27B0', width: 140, height: 70, icon: '👤' },
        delay: { label: 'Delay', color: '#607D8B', width: 140, height: 70, icon: '⏱' },
        // Outer loop annotation nodes - muted colors
        note: { label: 'Note', color: '#8D6E63', width: 140, height: 70, icon: '📝' },
        process: { label: 'Process', color: '#78909C', width: 140, height: 70, icon: '⚙' },
        decision: { label: 'Decision', color: '#A1887F', width: 140, height: 70, icon: '⬡' }
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
        if (rect.width === 0 || rect.height === 0) {
            return;
        }
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        // Reset transform before re-applying scale (avoids compounding on resize)
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
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

        // Draw nodes first so edges render on top of them
        for (const node of state.workflow.nodes) {
            drawNode(node);
        }

        // Draw edges after nodes so they remain visible when crossing over node bodies
        for (const edge of state.workflow.edges) {
            drawEdge(edge);
        }

        // Draw creating edge (in progress)
        if (state.creatingEdge) {
            drawCreatingEdge();
        }

        // Draw arrowheads last so they are visible on top of both edges and node backgrounds
        drawArrowheads();

        // Draw hovered port highlight (both edit and view mode)
        if (!state.draggingNode && !state.panning && !state.creatingEdge) {
            const mousePos = getCanvasPositionFromLastEvent();
            if (mousePos) {
                const portHover = hitTestDraggablePorts(mousePos);
                if (portHover) {
                    const node = state.workflow.nodes.find(n => n.id === portHover.nodeId);
                    if (node) {
                        const edge = state.workflow.edges.find(ed => ed.id === portHover.edgeId);
                        if (edge) {
                            const side = portHover.side === 'source' ? (edge.sourceSide || 'right') : (edge.targetSide || 'left');
                            const pos = getPortPosition(node, side);
                            ctx.fillStyle = portHover.side === 'source' ? 'rgba(76, 175, 80, 0.3)' : 'rgba(33, 150, 243, 0.3)';
                            ctx.beginPath();
                            ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                }
            }
        }

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
        const now = state.nowMs;

        // Determine color
        let color = config.color;
        if (state.executionStatus && state.executionStatus.nodeStatuses && state.executionStatus.nodeStatuses[node.id]) {
            const visualStatus = getVisualNodeStatus(node.id, state.executionStatus.nodeStatuses[node.id].status);
            // Only apply status colors for running, completed, failed, or paused states.
            // Nodes that are waiting or skipped should keep their default type color.
            if (visualStatus === 'running' || visualStatus === 'completed' || visualStatus === 'failed' || visualStatus === 'paused') {
                color = STATUS_COLORS[visualStatus] || config.color;
            }
        }

        // Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Node body
        const isAnnotation = ['note', 'process', 'decision'].includes(node.type);
        ctx.fillStyle = getThemeColor('inputBackground');
        ctx.strokeStyle = color;
        ctx.lineWidth = state.selectedNodeIds.has(node.id) ? 3 : 2;
        const isDiamond = node.type === 'condition' || node.type === 'decision';
        if (isAnnotation) {
            ctx.setLineDash([6, 4]);
        }
        if (isDiamond) {
            drawDiamond(ctx, x, y, w, h);
        } else {
            roundRect(ctx, x, y, w, h, 8);
        }
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Reset shadow
        ctx.shadowColor = 'transparent';

        // Runtime animation overlay for active nodes.
        const nodeAnimation = state.nodeAnimations[node.id];
        if (nodeAnimation) {
            const pulse = (Math.sin(state.animationTime * 0.08) + 1) / 2;
            if (nodeAnimation.mode === 'pulse') {
                ctx.strokeStyle = color;
                ctx.globalAlpha = 0.2 + pulse * 0.35;
                ctx.lineWidth = 2 + pulse * 2;
                if (isDiamond) {
                    drawDiamond(ctx, x - 4, y - 4, w + 8, h + 8);
                } else {
                    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 10);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            if (nodeAnimation.mode === 'flash') {
                const remaining = Math.max(0, (nodeAnimation.endTime || now) - now);
                const flashFactor = remaining > 0 ? 1 : 0;
                if (flashFactor > 0) {
                    const blink = Math.sin(state.animationTime * 0.28) > 0 ? 1 : 0.35;
                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.1 + blink * 0.2;
                    if (isDiamond) {
                        drawDiamond(ctx, x - 2, y - 2, w + 4, h + 4);
                    } else {
                        roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 9);
                    }
                    ctx.fill();
                    ctx.globalAlpha = 1;
                }
            }
        }

        // Header bar (skip for diamond-shaped nodes and note nodes)
        if (!isDiamond && node.type !== 'note') {
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

            // Execution count badge (top-right of header, always shown)
            const executionCount = state.nodeExecutionCounts[node.id] ?? 0;
            const badgeText = String(executionCount);
            ctx.font = 'bold 10px system-ui, sans-serif';
            const badgeMetrics = ctx.measureText(badgeText);
            const badgeW = badgeMetrics.width + 10;
            const badgeH = 16;
            const badgeX = x + w - badgeW - 6;
            const badgeY = y + 3;

            // Badge background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
            ctx.fill();

            // Badge text
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 12);
            ctx.textAlign = 'center';
        } else if (node.type === 'note') {
            // Note nodes: no header bar, no badge — just body text
        } else {
            // Diamond nodes: small execution badge at top-center outside the diamond
            const executionCount = state.nodeExecutionCounts[node.id] ?? 0;
            if (executionCount > 0) {
                const badgeText = String(executionCount);
                ctx.font = 'bold 10px system-ui, sans-serif';
                const badgeMetrics = ctx.measureText(badgeText);
                const badgeW = badgeMetrics.width + 10;
                const badgeH = 16;
                const badgeX = x + w / 2 - badgeW / 2;
                const badgeY = y - badgeH - 2;

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(badgeText, x + w / 2, badgeY + 12);
            }
        }

        // Icon and label
        ctx.fillStyle = getThemeColor('foreground');
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const displayLabel = getDisplayLabel(node);
        if (isDiamond) {
            // Center label inside diamond (no icon - diamond shape is the symbol)
            ctx.fillText(displayLabel, x + w / 2, y + h / 2 + 5);
        } else if (node.type === 'note') {
            // Note nodes: center text in body (no header)
            ctx.fillStyle = getThemeColor('foreground');
            ctx.font = '12px system-ui, sans-serif';
            const text = (node.data as any).text || '';
            const truncated = text.length > 40 ? text.substring(0, 37) + '...' : text;
            ctx.fillText(truncated, x + w / 2, y + h / 2 + 4);
        } else {
            ctx.fillStyle = '#fff';
            ctx.fillText(config.icon + ' ' + displayLabel, x + w / 2, y + h * 0.3 + 14);
        }

        // Sub-labels for annotation nodes
        if (node.type === 'process') {
            ctx.fillStyle = getThemeColor('descriptionForeground');
            ctx.font = '10px system-ui, sans-serif';
            const desc = (node.data as any).description || '';
            const truncated = desc.length > 25 ? desc.substring(0, 22) + '...' : desc;
            ctx.fillText(truncated, x + w / 2, y + h * 0.3 + 30);
        }
        if (node.type === 'decision') {
            ctx.fillStyle = getThemeColor('descriptionForeground');
            ctx.font = '10px system-ui, sans-serif';
            const options = (node.data as any).options || [];
            const optionText = options.length > 0 ? options.join(', ').substring(0, 25) : 'no options';
            ctx.fillText(optionText, x + w / 2, y + h * 0.3 + 30);
        }

        // Sub-labels for agent nodes: first line of prompt
        if (node.type === 'agent') {
            ctx.textAlign = 'center';
            const promptLine = getPromptFirstLine(node);
            if (promptLine) {
                const truncated = promptLine.length > 30 ? promptLine.substring(0, 27) + '...' : promptLine;
                ctx.fillStyle = getThemeColor('descriptionForeground');
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText(truncated, x + w / 2, y + h * 0.3 + 28);
            }
        }

        // Sub-labels for condition nodes: first line of prompt + model
        if (node.type === 'condition') {
            ctx.textAlign = 'center';
            const promptLine = getPromptFirstLine(node);
            const model = (node.data as any).model || '';
            if (promptLine) {
                const truncated = promptLine.length > 30 ? promptLine.substring(0, 27) + '...' : promptLine;
                ctx.fillStyle = getThemeColor('descriptionForeground');
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText(truncated, x + w / 2, y + h * 0.3 + 28);
            }
            if (model) {
                ctx.fillStyle = '#2196F3';
                ctx.font = 'bold 10px system-ui, sans-serif';
                ctx.fillText(model.substring(0, 20), x + w / 2, y + h * 0.3 + (promptLine ? 42 : 28));
            }
        }

        // Ports
        drawPorts(node, x, y, w, h);
    }

    function drawPorts(node, x, y, w, h) {
        const portRadius = 5;

        // Collect all sides used by edges connected to this node
        const sourceSides = new Set<string>();
        const targetSides = new Set<string>();
        for (const edge of state.workflow.edges) {
            if (edge.source === node.id) sourceSides.add(edge.sourceSide || 'right');
            if (edge.target === node.id) targetSides.add(edge.targetSide || 'left');
        }

        // Draw output ports (green) at each source side
        if (node.type !== 'end') {
            const outputSides = sourceSides.size > 0 ? sourceSides : new Set(['right']);
            for (const side of outputSides) {
                const pos = getPortPosition(node, side);
                ctx.fillStyle = '#4CAF50';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, portRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Draw input ports (blue) at each target side
        if (node.type !== 'start') {
            const inputSides = targetSides.size > 0 ? targetSides : new Set(['left']);
            for (const side of inputSides) {
                const pos = getPortPosition(node, side);
                ctx.fillStyle = '#2196F3';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, portRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Condition node has two output ports (True/False) on diamond vertices
        if (node.type === 'condition') {
            // True port (right vertex)
            ctx.fillStyle = '#4CAF50';
            ctx.beginPath();
            ctx.arc(x + w, y + h / 2, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#4CAF50';
            ctx.font = 'bold 9px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('True', x + w + 8, y + h / 2 + 3);

            // False port (left vertex)
            ctx.fillStyle = '#f44336';
            ctx.beginPath();
            ctx.arc(x, y + h / 2, portRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#f44336';
            ctx.font = 'bold 9px system-ui';
            ctx.textAlign = 'right';
            ctx.fillText('False', x - 8, y + h / 2 + 3);
        }
    }

    function drawEdge(edge) {
        const sourceNode = state.workflow.nodes.find(n => n.id === edge.source);
        const targetNode = state.workflow.nodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        // Use configurable port sides (default: right → left)
        const sourcePos = getPortPosition(sourceNode, edge.sourceSide || 'right');
        const targetPos = getPortPosition(targetNode, edge.targetSide || 'left');
        const sx = sourcePos.x;
        const sy = sourcePos.y;
        const tx = targetPos.x;
        const ty = targetPos.y;

        // Bezier curve control points based on port sides
        const dx = tx - sx;
        const dy = ty - sy;
        const curvature = 0.4;
        let cp1x, cp1y, cp2x, cp2y;
        const sourceSide = edge.sourceSide || 'right';
        const targetSide = edge.targetSide || 'left';
        if (sourceSide === 'top' || sourceSide === 'bottom') {
            cp1x = sx;
            cp1y = sy + (sourceSide === 'bottom' ? 1 : -1) * Math.max(Math.abs(dy) * curvature, 40);
        } else {
            cp1x = sx + (sourceSide === 'right' ? 1 : -1) * Math.max(Math.abs(dx) * curvature, 40);
            cp1y = sy;
        }
        if (targetSide === 'top' || targetSide === 'bottom') {
            cp2x = tx;
            cp2y = ty + (targetSide === 'bottom' ? 1 : -1) * Math.max(Math.abs(dy) * curvature, 40);
        } else {
            cp2x = tx + (targetSide === 'right' ? 1 : -1) * Math.max(Math.abs(dx) * curvature, 40);
            cp2y = ty;
        }

        const edgeAnimation = state.edgeAnimations[edge.id];
        const isEdgeAnimating = !!edgeAnimation && state.nowMs >= edgeAnimation.startTime && state.nowMs <= edgeAnimation.endTime;

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

        // Animate execution handoff only for edges explicitly scheduled by runtime events.
        if (isEdgeAnimating) {
            const elapsed = Math.max(0, state.nowMs - edgeAnimation.startTime);
            ctx.strokeStyle = getThemeColor('buttonBackground');
            ctx.lineWidth = isSelected ? 4 : 3;
            ctx.setLineDash([8, 4]);
            ctx.lineDashOffset = -(elapsed / state.animationConfig.edgeDashSpeed);
        } else {
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
        ctx.stroke();

        // Reset dash
        ctx.setLineDash([]);

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
        const { sourceNodeId, sourcePort, currentX, currentY } = state.creatingEdge;
        const sourceNode = state.workflow.nodes.find(n => n.id === sourceNodeId);
        if (!sourceNode) return;

        const config = NODE_CONFIGS[sourceNode.type];
        const w = config ? config.width : 140;
        const h = config ? config.height : 70;
        let sx, sy;

        // Use correct port position for condition node True/False ports
        if (sourceNode.type === 'condition') {
            if (sourcePort === 'true') {
                sx = sourceNode.position.x + w;
                sy = sourceNode.position.y + h / 2;
            } else if (sourcePort === 'false') {
                sx = sourceNode.position.x;
                sy = sourceNode.position.y + h / 2;
            } else {
                sx = sourceNode.position.x + w;
                sy = sourceNode.position.y + h / 2;
            }
        } else {
            sx = sourceNode.position.x + w;
            sy = sourceNode.position.y + h / 2;
        }

        const color = sourcePort === 'true' ? '#4CAF50' : sourcePort === 'false' ? '#f44336' : '#4CAF50';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw arrowhead at the current mouse position
        const angle = Math.atan2(currentY - sy, currentX - sx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(currentX, currentY);
        ctx.lineTo(currentX - 10 * Math.cos(angle - Math.PI / 6), currentY - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(currentX - 10 * Math.cos(angle + Math.PI / 6), currentY - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
    }

    function drawArrowheads() {
        for (const edge of state.workflow.edges) {
            const sourceNode = state.workflow.nodes.find(n => n.id === edge.source);
            const targetNode = state.workflow.nodes.find(n => n.id === edge.target);
            if (!sourceNode || !targetNode) continue;

            const sourcePos = getPortPosition(sourceNode, edge.sourceSide || 'right');
            const targetPos = getPortPosition(targetNode, edge.targetSide || 'left');
            const sx = sourcePos.x;
            const sy = sourcePos.y;
            const tx = targetPos.x;
            const ty = targetPos.y;

            // Bezier curve control points (same as drawEdge)
            const dx = tx - sx;
            const dy = ty - sy;
            const curvature = 0.4;
            let cp1x, cp1y, cp2x, cp2y;
            const sourceSide = edge.sourceSide || 'right';
            const targetSide = edge.targetSide || 'left';
            if (sourceSide === 'top' || sourceSide === 'bottom') {
                cp1x = sx;
                cp1y = sy + (sourceSide === 'bottom' ? 1 : -1) * Math.max(Math.abs(dy) * curvature, 40);
            } else {
                cp1x = sx + (sourceSide === 'right' ? 1 : -1) * Math.max(Math.abs(dx) * curvature, 40);
                cp1y = sy;
            }
            if (targetSide === 'top' || targetSide === 'bottom') {
                cp2x = tx;
                cp2y = ty + (targetSide === 'bottom' ? 1 : -1) * Math.max(Math.abs(dy) * curvature, 40);
            } else {
                cp2x = tx + (targetSide === 'right' ? 1 : -1) * Math.max(Math.abs(dx) * curvature, 40);
                cp2y = ty;
            }

            const edgeAnimation = state.edgeAnimations[edge.id];
            const isEdgeAnimating = !!edgeAnimation && state.nowMs >= edgeAnimation.startTime && state.nowMs <= edgeAnimation.endTime;
            const isSelected = state.selectedEdgeId === edge.id;

            // Tangent direction at the target (direction of curve travel as it arrives).
            const tangentAngle = Math.atan2(ty - cp2y, tx - cp2x);
            // Offset the tip slightly back along the tangent so the arrowhead sits
            // just before the node boundary and isn't covered by the node fill.
            const tipOffset = 3;
            const ax = tx - tipOffset * Math.cos(tangentAngle);
            const ay = ty - tipOffset * Math.sin(tangentAngle);
            // Arrowhead points in the direction of travel; base extends opposite.
            ctx.fillStyle = isEdgeAnimating
                ? getThemeColor('buttonBackground')
                : isSelected
                    ? getThemeColor('focusBorder')
                    : getThemeColor('descriptionForeground');
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - 10 * Math.cos(tangentAngle - Math.PI / 6), ay - 10 * Math.sin(tangentAngle - Math.PI / 6));
            ctx.lineTo(ax - 10 * Math.cos(tangentAngle + Math.PI / 6), ay - 10 * Math.sin(tangentAngle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
        }
    }

    // ===== Mouse Events =====
    function onMouseDown(e) {
        const pos = getCanvasPosition(e);

        // Check if clicking on a port to drag it (both edit and view mode)
        const portDragHit = hitTestDraggablePorts(pos);
        if (portDragHit) {
            draggingPort = {
                edgeId: portDragHit.edgeId,
                side: portDragHit.side as 'source' | 'target',
                nodeId: portDragHit.nodeId
            };
            canvas.style.cursor = 'grabbing';
            return;
        }

        // Check if clicking on an output port (start edge creation) — both modes
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

        // Check if clicking on an edge (for selection) — both modes
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

            // Start dragging — both modes
            state.draggingNode = node.id;
            state.draggingOffset = {
                x: pos.x - node.position.x,
                y: pos.y - node.position.y
            };
            if (state.editMode) saveHistory();
            render();
            updatePropertiesPanel(node);
            return;
        }

        // Click on empty canvas - start panning or clear selection
        if (e.button === 1) {
            // Middle mouse: always pan
            state.panning = true;
            state.panStart = { x: e.clientX - state.viewport.x, y: e.clientY - state.viewport.y };
        } else if (state.selectedNodeIds.size === 0 && !state.selectedEdgeId) {
            // Left click on empty canvas: pan (both modes)
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
        lastMouseCanvasPos = pos;

        // Port dragging (both edit and view mode)
        if (draggingPort) {
            const node = state.workflow.nodes.find(n => n.id === draggingPort.nodeId);
            if (node) {
                const edge = state.workflow.edges.find(ed => ed.id === draggingPort.edgeId);
                if (edge) {
                    const newSide = snapSideToBorder(node, pos);
                    if (draggingPort.side === 'source') {
                        edge.sourceSide = newSide;
                    } else {
                        edge.targetSide = newSide;
                    }
                    render();
                }
            }
            return;
        }

        // Cursor feedback for draggable ports (both edit and view mode)
        if (!state.draggingNode && !state.panning && !state.creatingEdge) {
            const portHover = hitTestDraggablePorts(pos);
            canvas.style.cursor = portHover ? 'grab' : 'default';
        }

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
    }

    function onMouseUp(e) {
        const pos = getCanvasPosition(e);

        // Stop port dragging
        if (draggingPort) {
            draggingPort = null;
            canvas.style.cursor = 'default';
            saveHistory();
            notifyWorkflowUpdate();
            render();
            return;
        }

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
                        // Determine sourceSide based on condition port
                        let sourceSide = 'right';
                        if (sourceNode.type === 'condition') {
                            sourceSide = state.creatingEdge.sourcePort === 'true' ? 'right' : 'left';
                        }
                        state.workflow.edges.push({
                            id: `${state.creatingEdge.sourceNodeId}->${portHit.nodeId}`,
                            source: state.creatingEdge.sourceNodeId,
                            target: portHit.nodeId,
                            sourceSide,
                            targetSide: 'left',
                            label: state.creatingEdge.sourcePort === 'true' ? 'True' : state.creatingEdge.sourcePort === 'false' ? 'False' : ''
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

        if (state.draggingNode) {
            notifyWorkflowUpdate();
            state.draggingNode = null;
        }
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

        if (state.editMode && (e.key === 'Delete' || e.key === 'Backspace')) {
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

            const x = node.position.x;
            const y = node.position.y;
            const w = config.width;
            const h = config.height;

            // Diamond-shaped nodes use point-in-diamond hit test
            if (node.type === 'condition' || node.type === 'decision') {
                const cx = x + w / 2;
                const cy = y + h / 2;
                const dx = Math.abs(pos.x - cx);
                const dy = Math.abs(pos.y - cy);
                if (dx / (w / 2) + dy / (h / 2) <= 1) {
                    return node;
                }
            } else {
                if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
                    return node;
                }
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

    function hitTestDraggablePorts(pos) {
        const hitRadius = 10; // 10px radius for port hit testing
        for (const edge of state.workflow.edges) {
            // Check source port
            const sourceNode = state.workflow.nodes.find(n => n.id === edge.source);
            if (sourceNode) {
                const sourcePos = getPortPosition(sourceNode, edge.sourceSide || 'right');
                const dx = pos.x - sourcePos.x;
                const dy = pos.y - sourcePos.y;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    return { edgeId: edge.id, side: 'source', nodeId: sourceNode.id };
                }
            }
            // Check target port
            const targetNode = state.workflow.nodes.find(n => n.id === edge.target);
            if (targetNode) {
                const targetPos = getPortPosition(targetNode, edge.targetSide || 'left');
                const dx = pos.x - targetPos.x;
                const dy = pos.y - targetPos.y;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    return { edgeId: edge.id, side: 'target', nodeId: targetNode.id };
                }
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
                // True port (right vertex of diamond)
                const dx1 = pos.x - (x + w);
                const dy1 = pos.y - (y + h / 2);
                if (dx1 * dx1 + dy1 * dy1 < 64) {
                    return { nodeId: node.id, port: 'true' };
                }
                // False port (left vertex of diamond)
                const dx2 = pos.x - x;
                const dy2 = pos.y - (y + h / 2);
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
                // True port (right vertex of diamond)
                const dx1 = pos.x - (x + w);
                const dy1 = pos.y - (y + h / 2);
                if (dx1 * dx1 + dy1 * dy1 < 64) {
                    return { nodeId: node.id, port: 'true' };
                }
                // False port (left vertex of diamond)
                const dx2 = pos.x - x;
                const dy2 = pos.y - (y + h / 2);
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
            case 'note': return { text: 'Note text here', description: '' };
            case 'process': return { title: 'Process name', description: '' };
            case 'decision': return { question: 'Decision question?', options: [] };
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
            // Edit mode ON — show panels
            toolbox.classList.remove('hidden');
            propertiesPanel.classList.remove('hidden');
            btn.classList.add('active');
            btn.title = 'Exit Edit Mode';
        } else {
            // Edit mode OFF — hide panels
            toolbox.classList.add('hidden');
            propertiesPanel.classList.add('hidden');
            btn.classList.remove('active');
            btn.title = 'Enter Edit Mode';
        }

        // Resize canvas after panels slide in/out
        setTimeout(() => resizeCanvas(), 250);
    }

    // Apply initial edit mode state (default: OFF / panels hidden)
    function applyInitialEditMode() {
        const toolbox = document.getElementById('toolbox');
        const propertiesPanel = document.getElementById('properties-panel');
        const btn = document.getElementById('btn-edit-mode');
        if (toolbox) toolbox.classList.add('hidden');
        if (propertiesPanel) propertiesPanel.classList.add('hidden');
        if (btn) btn.title = 'Enter Edit Mode';
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
                html += propertyField('Timeout (sec)', 'number', node.data.timeout || 120);
                html += propertyField('Retries', 'number', node.data.retries || 0);
                html += renderStateMappings(node);
                break;
            case 'condition':
                html += propertyField('Model', 'text', node.data.model || '', 'e.g., Claude Sonnet 4.6 (copilot)');
                html += propertyField('Prompt', 'textarea', node.data.prompt || '', 'Reasoning instructions for routing decision');
                html += propertyField('Timeout (sec)', 'number', node.data.timeout || 120);
                break;
            case 'human_approval':
                html += propertyField('Message', 'textarea', node.data.message || 'Approve this step?');
                break;
            case 'delay':
                html += propertyField('Duration (sec)', 'number', node.data.duration || 5);
                break;
            case 'note':
                html += propertyField('Text', 'textarea', node.data.text || '', 'Note text content');
                break;
            case 'process':
                html += propertyField('Title', 'text', node.data.title || '', 'Process title');
                break;
            case 'decision':
                html += propertyField('Question', 'text', node.data.question || '', 'Decision question');
                html += renderDecisionOptions(node);
                break;
        }

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

    /** Get display label for a node (handles annotation nodes). */
    function getDisplayLabel(node) {
        if (node.type === 'note') return 'Note';
        if (node.type === 'process') return (node.data as any).title || 'Process';
        if (node.type === 'decision') return (node.data as any).question?.substring(0, 18) || 'Decision';
        // Condition nodes: diamond shape is the symbol — no text label needed
        if (node.type === 'condition') return '';
        // Agent nodes: include model name on the same line as the label
        if (node.type === 'agent') {
            const label = node.data.label || NODE_CONFIGS[node.type]?.label || node.id;
            const model = node.data.model || '';
            if (model) {
                return label + ' ' + model.substring(0, 25);
            }
            return label;
        }
        return node.data.label || NODE_CONFIGS[node.type]?.label || node.id;
    }

    /** Get the first line of a node's prompt (for agent and condition nodes). */
    function getPromptFirstLine(node) {
        const prompt = (node.data as any).prompt;
        if (!prompt || typeof prompt !== 'string') return null;
        const firstLine = prompt.split('\n')[0].trim();
        return firstLine || null;
    }

    /** Render decision options editor in properties panel. */
    function renderDecisionOptions(node) {
        const options = (node.data as any).options || [];
        let html = `<div class="property-section">
            <label>Options</label>
            <div class="mappings-list">`;

        if (options.length === 0) {
            html += '<div class="mappings-empty">No options configured</div>';
        } else {
            options.forEach((opt, idx) => {
                html += `<div class="mapping-entry">
                    <input type="text" class="mapping-input" placeholder="Option ${idx + 1}" value="${escapeHtml(opt)}"
                        onchange="updateDecisionOption(${idx}, this.value)">
                    <button class="mapping-remove-btn" onclick="removeDecisionOption(${idx})">✕</button>
                </div>`;
            });
        }

        html += `</div>
            <button class="add-mapping-btn" onclick="addDecisionOption()">+ Add Option</button>
        </div>`;
        return html;
    }

    function addDecisionOption() {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'decision') return;

        if (!(node.data as any).options) {
            (node.data as any).options = [];
        }
        (node.data as any).options.push('');

        saveHistory();
        render();
        updatePropertiesPanel(node);
        notifyWorkflowUpdate();
    }

    function removeDecisionOption(index) {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'decision') return;
        if (!(node.data as any).options) return;

        (node.data as any).options = (node.data as any).options.filter((_, i) => i !== index);

        saveHistory();
        render();
        updatePropertiesPanel(node);
        notifyWorkflowUpdate();
    }

    function updateDecisionOption(index, value) {
        const nodeId = Array.from(state.selectedNodeIds).pop();
        if (!nodeId) return;
        const node = state.workflow.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'decision') return;
        if (!(node.data as any).options) return;

        (node.data as any).options[index] = value;

        saveHistory();
        render();
        notifyWorkflowUpdate();
    }

    // Expose decision option functions globally for onclick handlers
    (window as any).addDecisionOption = addDecisionOption;
    (window as any).removeDecisionOption = removeDecisionOption;
    (window as any).updateDecisionOption = updateDecisionOption;

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
            'Duration (sec)': 'duration',
            'Text': 'text',
            'Title': 'title',
            'Question': 'question'
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
                if (msg.animationConfig) {
                    state.animationConfig.startNodeFlashMs = sanitizeAnimationNumber(msg.animationConfig.startNodeFlashMs, 3000, 0);
                    state.animationConfig.edgeHandoffMs = sanitizeAnimationNumber(msg.animationConfig.edgeHandoffMs, 3000, 0);
                    state.animationConfig.endNodeFlashMs = sanitizeAnimationNumber(msg.animationConfig.endNodeFlashMs, 1200, 0);
                    state.animationConfig.edgeDashSpeed = sanitizeAnimationNumber(msg.animationConfig.edgeDashSpeed, 20, 1);
                }
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
                if (msg.status.nodeExecutionCounts) {
                    state.nodeExecutionCounts = msg.status.nodeExecutionCounts;
                }
                updateExecutionAnimations(msg.status);
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

    // ===== Execution Animations (event-driven) =====
    function updateExecutionAnimations(status, nowOverride?) {
        const now = typeof nowOverride === 'number' ? nowOverride : performance.now();
        state.nowMs = now;

        if (!status || !status.nodeStatuses) {
            return;
        }

        const nodeStatuses = status.nodeStatuses;
        const currentIds = Object.keys(nodeStatuses);

        if (status.overall === 'idle' || status.overall === 'stopped' || status.overall === 'failed') {
            state.edgeAnimations = {};
            state.nodeAnimations = {};
            state.pendingNodePulses = {};
            state.previousNodeStatuses = currentIds.reduce((acc, id) => {
                acc[id] = nodeStatuses[id].status;
                return acc;
            }, {} as Record<string, string>);
            state.previousCurrentNodeId = status.currentNodeId || null;
            state.previousOverallStatus = status.overall;
            return;
        }

        // Process completions first so source-node flash state exists before scheduling edge handoff.
        for (const nodeId of currentIds) {
            const currentStatus = nodeStatuses[nodeId].status;
            const previousStatus = state.previousNodeStatuses[nodeId];
            const nodeType = getNodeType(nodeId);
            const becameCompleted = currentStatus === 'completed' && previousStatus !== 'completed';

            if (becameCompleted) {
                delete state.pendingNodePulses[nodeId];
                delete state.nodeAnimations[nodeId];

                if (nodeType === 'start' && status.overall === 'running') {
                    state.nodeAnimations[nodeId] = { mode: 'flash', endTime: now + state.animationConfig.startNodeFlashMs };
                }

                // End node uses a short completion flash as minimum acceptance animation.
                if (nodeType === 'end') {
                    state.nodeAnimations[nodeId] = { mode: 'flash', endTime: now + state.animationConfig.endNodeFlashMs };
                }
            }
        }

        // Process running transitions after completion bookkeeping.
        for (const nodeId of currentIds) {
            const currentStatus = nodeStatuses[nodeId].status;
            const previousStatus = state.previousNodeStatuses[nodeId];
            const nodeType = getNodeType(nodeId);
            const becameRunning = currentStatus === 'running' && previousStatus !== 'running';

            if (becameRunning) {
                scheduleRunningNodeAnimation(nodeId, now, status, nodeType);
            }

            if (previousStatus === 'running' && currentStatus !== 'running') {
                delete state.pendingNodePulses[nodeId];
                if (state.nodeAnimations[nodeId]?.mode === 'pulse') {
                    delete state.nodeAnimations[nodeId];
                }
            }
        }

        state.previousNodeStatuses = currentIds.reduce((acc, id) => {
            acc[id] = nodeStatuses[id].status;
            return acc;
        }, {} as Record<string, string>);
        state.previousCurrentNodeId = status.currentNodeId || null;
        state.previousOverallStatus = status.overall;
    }

    function scheduleRunningNodeAnimation(nodeId, now, status, nodeType) {
        const transition = findTransitionEdge(nodeId, status);

        if (!transition) {
            if (nodeType !== 'end') {
                state.nodeAnimations[nodeId] = { mode: 'pulse' };
            }
            return;
        }

        const sourceFlashEnd = state.nodeAnimations[transition.sourceId]?.mode === 'flash'
            ? state.nodeAnimations[transition.sourceId].endTime || now
            : now;
        const edgeStart = Math.max(now, sourceFlashEnd);
        const edgeEnd = edgeStart + state.animationConfig.edgeHandoffMs;

        state.edgeAnimations[transition.edge.id] = {
            startTime: edgeStart,
            endTime: edgeEnd
        };

        if (nodeType !== 'end') {
            state.pendingNodePulses[nodeId] = edgeEnd;
        }
    }

    function findTransitionEdge(targetNodeId, status) {
        const incomingEdges = state.workflow.edges.filter(e => e.target === targetNodeId);
        if (incomingEdges.length === 0) {
            return null;
        }

        const completedSources = incomingEdges
            .map(edge => {
                const srcStatus = status.nodeStatuses[edge.source]?.status;
                return { edge, sourceId: edge.source, status: srcStatus };
            })
            .filter(item => item.status === 'completed');

        if (completedSources.length === 0) {
            return null;
        }

        const currentSource = completedSources.find(item => item.sourceId === state.previousCurrentNodeId);
        if (currentSource) {
            return currentSource;
        }

        const startSource = completedSources.find(item => getNodeType(item.sourceId) === 'start');
        if (startSource) {
            return startSource;
        }

        return completedSources[0];
    }

    function getNodeType(nodeId) {
        return state.workflow.nodes.find(n => n.id === nodeId)?.type;
    }

    function getVisualNodeStatus(nodeId, runtimeStatus) {
        // While waiting for edge handoff to finish, keep node visually in waiting state.
        if (runtimeStatus === 'running' && state.pendingNodePulses[nodeId]) {
            return 'waiting';
        }
        return runtimeStatus;
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

    /** Draw a diamond/rhombus shape centered at (x+w/2, y+h/2) with the given width and height. */
    function drawDiamond(ctx, x, y, w, h) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);          // top
        ctx.lineTo(x + w, cy);      // right
        ctx.lineTo(cx, y + h);      // bottom
        ctx.lineTo(x, cy);          // left
        ctx.closePath();
    }

    // ===== Animation Loop =====
    function startAnimationLoop() {
        if (state.animationFrameId) return; // Already running
        animate();
    }

    function animate() {
        state.animationFrameId = requestAnimationFrame(() => {
            state.animationTime += 0.5; // Speed of dash animation
            state.nowMs = performance.now();
            pruneAnimationState(state.nowMs);
            render();
            animate();
        });
    }

    function pruneAnimationState(now) {
        for (const [edgeId, edgeAnim] of Object.entries(state.edgeAnimations)) {
            if (now > edgeAnim.endTime) {
                delete state.edgeAnimations[edgeId];
            }
        }

        for (const [nodeId, nodeAnim] of Object.entries(state.nodeAnimations)) {
            if (nodeAnim.mode === 'flash' && nodeAnim.endTime && now > nodeAnim.endTime) {
                delete state.nodeAnimations[nodeId];
            }
        }

        for (const [nodeId, startAt] of Object.entries(state.pendingNodePulses)) {
            const runtimeStatus = state.executionStatus?.nodeStatuses?.[nodeId]?.status;
            if (runtimeStatus !== 'running') {
                delete state.pendingNodePulses[nodeId];
                continue;
            }
            if (now >= startAt) {
                state.nodeAnimations[nodeId] = { mode: 'pulse' };
                delete state.pendingNodePulses[nodeId];
            }
        }
    }

    function sanitizeAnimationNumber(value, fallback, minimum) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.max(minimum, parsed);
    }

    function publishTestApi() {
        const host = window as any;
        if (!host.__WORKFLOW_DESIGNER_TEST_MODE) {
            return;
        }

        host.__workflowDesignerTestApi = {
            simulateMessage: (msg) => {
                onMessage({ data: msg } as MessageEvent);
            },
            simulateExecutionUpdate: (status, nowOverride?) => {
                state.executionStatus = status;
                if (status.nodeExecutionCounts) {
                    state.nodeExecutionCounts = status.nodeExecutionCounts;
                }
                updateExecutionAnimations(status, nowOverride);
                render();
            },
            tickTo: (now) => {
                state.nowMs = now;
                pruneAnimationState(now);
                render();
            },
            getEdgeSides: (edgeId) => {
                const edge = state.workflow.edges.find((candidate) => candidate.id === edgeId);
                if (!edge) {
                    return null;
                }

                return {
                    sourceSide: edge.sourceSide || 'right',
                    targetSide: edge.targetSide || 'left'
                };
            },
            getAnimationSnapshot: () => ({
                edgeAnimations: { ...state.edgeAnimations },
                nodeAnimations: { ...state.nodeAnimations },
                pendingNodePulses: { ...state.pendingNodePulses },
                nowMs: state.nowMs,
                animationConfig: { ...state.animationConfig }
            }),
            getVisualStatus: (nodeId, runtimeStatus) => getVisualNodeStatus(nodeId, runtimeStatus)
        };
    }

    // ===== Double Click Handler =====
    function onDoubleClick(e) {
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
    publishTestApi();
    // Start animation loop for edge flow animation
    startAnimationLoop();
})();
