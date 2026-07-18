import * as vscode from 'vscode';
import { NodeExecutionRecord, ExecutionStatus, WorkflowState } from '../models/workflow';

/**
 * Execution Details Panel - shows node execution details
 */
export class ExecutionDetailsPanel {
    public static currentPanel: ExecutionDetailsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.options = {
            enableScripts: true
        };
        this._update();
        this._setWebviewMessageListener();
    }

    public static renderNodeDetails(
        context: vscode.ExtensionContext,
        record: NodeExecutionRecord,
        state: WorkflowState
    ): void {
        if (ExecutionDetailsPanel.currentPanel) {
            ExecutionDetailsPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            ExecutionDetailsPanel.currentPanel._updateNode(record, state);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'executionDetails',
                `Execution: ${record.nodeName || record.nodeId}`,
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );

            ExecutionDetailsPanel.currentPanel = new ExecutionDetailsPanel(panel);
            ExecutionDetailsPanel.currentPanel._updateNode(record, state);
            context.subscriptions.push(ExecutionDetailsPanel.currentPanel);
        }
    }

    public static renderTimeline(
        context: vscode.ExtensionContext,
        records: Map<string, NodeExecutionRecord>,
        state: WorkflowState
    ): void {
        const panel = vscode.window.createWebviewPanel(
            'executionTimeline',
            'Execution Timeline',
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        const timeline = new ExecutionDetailsPanel(panel);
        timeline._updateTimeline(records, state);
        context.subscriptions.push(timeline);
    }

    public dispose() {
        ExecutionDetailsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtml();
    }

    private _updateNode(record: NodeExecutionRecord, state: WorkflowState) {
        this._panel.webview.html = this._getNodeDetailsHtml(record, state);
        this._panel.title = `Execution: ${record.nodeName || record.nodeId}`;
    }

    private _updateTimeline(records: Map<string, NodeExecutionRecord>, state: WorkflowState) {
        this._panel.webview.html = this._getTimelineHtml(records, state);
        this._panel.title = 'Execution Timeline';
    }

    private _setWebviewMessageListener() {
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'close':
                    this.dispose();
                    break;
            }
        }, undefined, this._disposables);
    }

    private _getHtml() {
        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
    body { font-family: system-ui; padding: 16px; color: var(--vscode-foreground); }
    h2 { margin: 0 0 16px; font-size: 16px; }
</style></head>
<body><h2>Execution Details</h2><p>Select a node to view details.</p></body>
</html>`;
    }

    private _getNodeDetailsHtml(record: NodeExecutionRecord, state: WorkflowState): string {
        const statusColors: Record<string, string> = {
            waiting: '#9E9E9E',
            running: '#2196F3',
            completed: '#4CAF50',
            failed: '#f44336',
            paused: '#FFC107',
            skipped: '#BDBDBD'
        };

        const duration = record.duration ? `${record.duration}ms` : 'N/A';
        const startTime = record.startTime ? new Date(record.startTime).toLocaleTimeString() : 'N/A';
        const endTime = record.endTime ? new Date(record.endTime).toLocaleTimeString() : 'N/A';

        const logsHtml = record.logs?.map(l => `<div class="log-line">${this._escapeHtml(l)}</div>`).join('') || '';
        const errorsHtml = record.errors?.map(e => `<div class="error-line">${this._escapeHtml(e)}</div>`).join('') || '';
        const filesHtml = record.filesModified?.map(f => `<div class="file-item">${this._escapeHtml(f)}</div>`).join('') || '<div class="empty">No files modified</div>';

        const structuredOutput = record.structuredOutput
            ? `<pre>${this._escapeHtml(JSON.stringify(record.structuredOutput, null, 2))}</pre>`
            : '<div class="empty">No structured output</div>';

        const stateHtml = Object.keys(state).length > 0
            ? `<pre>${this._escapeHtml(JSON.stringify(state, null, 2))}</pre>`
            : '<div class="empty">No state</div>';

        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
    body { font-family: system-ui; padding: 16px; color: var(--vscode-foreground, #333); font-size: 13px; }
    h2 { margin: 0 0 16px; font-size: 16px; }
    h3 { margin: 16px 0 8px; font-size: 13px; color: var(--vscode-descriptionForeground, #888); text-transform: uppercase; letter-spacing: 0.5px; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; color: #fff; background: ${statusColors[record.status] || '#999'}; }
    .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; margin-bottom: 16px; }
    .detail-label { color: var(--vscode-descriptionForeground, #888); }
    .detail-value { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; }
    .section { margin-bottom: 16px; }
    .log-line, .error-line, .file-item { padding: 2px 0; font-family: 'Consolas', monospace; font-size: 12px; }
    .error-line { color: #f44336; }
    pre { background: var(--vscode-editor-background, #f5f5f5); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
    .empty { color: var(--vscode-descriptionForeground, #888); font-style: italic; }
</style></head>
<body>
    <h2>${this._escapeHtml(record.nodeName || record.nodeId)} <span class="status-badge">${record.status}</span></h2>

    <div class="detail-grid">
        <span class="detail-label">Node ID</span><span class="detail-value">${this._escapeHtml(record.nodeId)}</span>
        <span class="detail-label">Status</span><span class="detail-value">${record.status}</span>
        <span class="detail-label">Start Time</span><span class="detail-value">${startTime}</span>
        <span class="detail-label">End Time</span><span class="detail-value">${endTime}</span>
        <span class="detail-label">Duration</span><span class="detail-value">${duration}</span>
    </div>

    ${record.prompt ? `<div class="section"><h3>Prompt</h3><pre>${this._escapeHtml(record.prompt)}</pre></div>` : ''}

    ${record.contextIn ? `<div class="section"><h3>Context In</h3><pre>${this._escapeHtml(JSON.stringify(record.contextIn, null, 2))}</pre></div>` : ''}

    ${record.contextOut ? `<div class="section"><h3>Context Out</h3><pre>${this._escapeHtml(JSON.stringify(record.contextOut, null, 2))}</pre></div>` : ''}

    <div class="section"><h3>Structured Output</h3>${structuredOutput}</div>

    <div class="section"><h3>Files Modified</h3>${filesHtml}</div>

    ${record.toolUsage && record.toolUsage.length > 0 ? `<div class="section"><h3>Tool Usage</h3><pre>${this._escapeHtml(JSON.stringify(record.toolUsage, null, 2))}</pre></div>` : ''}

    <div class="section"><h3>Logs</h3>${logsHtml || '<div class="empty">No logs</div>'}</div>

    ${errorsHtml ? `<div class="section"><h3>Errors</h3>${errorsHtml}</div>` : ''}

    <div class="section"><h3>Workflow State</h3>${stateHtml}</div>
</body>
</html>`;
    }

    private _getTimelineHtml(records: Map<string, NodeExecutionRecord>, state: WorkflowState): string {
        const entries = Array.from(records.entries());
        const maxDuration = Math.max(...entries.map(([, r]) => r.duration || 0), 1);

        const rows = entries.map(([id, record]) => {
            const width = Math.max(2, (record.duration || 0) / maxDuration * 100);
            const statusColors: Record<string, string> = {
                completed: '#4CAF50',
                failed: '#f44336',
                running: '#2196F3',
                paused: '#FFC107',
                skipped: '#BDBDBD',
                waiting: '#9E9E9E'
            };
            const color = statusColors[record.status] || '#999';
            const duration = record.duration ? `${record.duration}ms` : '-';
            const name = record.nodeName || id;

            return `<div class="timeline-row">
                <div class="timeline-label">${this._escapeHtml(name)}</div>
                <div class="timeline-bar-container">
                    <div class="timeline-bar" style="width: ${width}%; background: ${color};">
                        <span class="timeline-duration">${duration}</span>
                    </div>
                </div>
                <div class="timeline-status">${record.status}</div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
    body { font-family: system-ui; padding: 16px; color: var(--vscode-foreground, #333); font-size: 13px; }
    h2 { margin: 0 0 16px; font-size: 16px; }
    .timeline-row { display: grid; grid-template-columns: 140px 1fr 80px; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #eee); }
    .timeline-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .timeline-bar-container { background: var(--vscode-editor-background, #f5f5f5); border-radius: 3px; height: 20px; overflow: hidden; }
    .timeline-bar { height: 100%; border-radius: 3px; display: flex; align-items: center; padding-left: 6px; min-width: 30px; }
    .timeline-duration { color: #fff; font-size: 10px; font-weight: 600; }
    .timeline-status { font-size: 11px; text-transform: uppercase; font-weight: 600; }
</style></head>
<body>
    <h2>Execution Timeline (${entries.length} nodes)</h2>
    ${rows || '<div class="empty">No execution data</div>'}
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
