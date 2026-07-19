import * as vscode from 'vscode';
import { Workflow } from '../models/workflow';
import { workflowToYaml, yamlToWorkflow } from '../utils/yamlSerializer';

/**
 * Custom editor provider for workflow designer
 */
export class WorkflowDesignerProvider implements vscode.CustomEditorProvider<WorkflowDocument> {

    public static readonly viewType = 'workflowDesigner.editor';
    private readonly webviews: Map<string, vscode.Webview> = new Map();
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<WorkflowDocument>>();
    private runtime: any; // WorkflowRuntime reference set via setRuntime()

    constructor(private readonly context: vscode.ExtensionContext) { }

    setRuntime(runtime: any): void {
        this.runtime = runtime;
        // Subscribe to execution state changes and forward to all webviews
        runtime.onDidChangeExecutionState((status: any) => {
            for (const webview of this.webviews.values()) {
                webview.postMessage({
                    type: 'executionUpdate',
                    status
                });
            }
        });
        // Subscribe to log messages and forward to all webviews
        runtime.onDidLogMessage((message: string) => {
            for (const webview of this.webviews.values()) {
                webview.postMessage({
                    type: 'logMessage',
                    message
                });
            }
        });
    }

    get onDidChangeCustomDocument() {
        return this._onDidChangeCustomDocument.event;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<WorkflowDocument> {
        const document = new WorkflowDocument(uri, this._onDidChangeCustomDocument);

        if (openContext.backupId) {
            await document.fromBackup(openContext.backupId);
        } else {
            await document.load();
        }

        return document;
    }

    async resolveCustomEditor(
        document: WorkflowDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'webview'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
            ]
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        this.webviews.set(document.uri.toString(), webviewPanel.webview);

        // Send initial workflow data
        this.postMessage(webviewPanel.webview, {
            type: 'init',
            workflow: document.workflow
        });

        // Set current workflow on runtime
        if (this.runtime) {
            this.runtime.setCurrentWorkflow(document.workflow, document.uri);
        }

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'updateWorkflow':
                    document.updateWorkflow(msg.workflow);
                    // Update runtime with latest workflow
                    if (this.runtime) {
                        this.runtime.setCurrentWorkflow(document.workflow, document.uri);
                    }
                    break;
                case 'save':
                    await document.save();
                    break;
                case 'run':
                    if (this.runtime) {
                        this.runtime.setCurrentWorkflow(document.workflow, document.uri);
                        await this.runtime.runCurrentWorkflow();
                    } else {
                        vscode.window.showErrorMessage('Workflow runtime is not initialized.');
                    }
                    break;
                case 'pause':
                    if (this.runtime) this.runtime.pause();
                    break;
                case 'stop':
                    if (this.runtime) this.runtime.stop();
                    break;
                case 'resume':
                    if (this.runtime) this.runtime.resume();
                    break;
                case 'nodeSelected':
                    // Could open details panel
                    break;
                case 'error':
                    vscode.window.showErrorMessage(`Workflow Designer: ${msg.message}`);
                    break;
                case 'validate':
                    // Validate and send results back to webview
                    if (this.runtime) {
                        const errors = this.runtime.validate(document.workflow);
                        webviewPanel.webview.postMessage({
                            type: 'validationResult',
                            errors
                        });
                    }
                    break;
            }
        });

        webviewPanel.onDidDispose(() => {
            this.webviews.delete(document.uri.toString());
        });
    }

    async saveCustomDocument(document: WorkflowDocument, cancellation: vscode.CancellationToken): Promise<void> {
        await document.save();
    }

    async saveCustomDocumentAs(document: WorkflowDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        await document.saveAs(destination);
    }

    async revertCustomDocument(document: WorkflowDocument, cancellation: vscode.CancellationToken): Promise<void> {
        await document.load();
    }

    async backupCustomDocument(document: WorkflowDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await document.backup(context.destination);
        return {
            id: context.destination.fsPath,
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch { }
            }
        };
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'designer.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'designer.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>Workflow Designer</title>
</head>
<body>
    <div id="app">
        <div id="toolbar">
            <button id="btn-run" title="Run Workflow">▶ Run</button>
            <button id="btn-pause" title="Pause Workflow">⏸ Pause</button>
            <button id="btn-stop" title="Stop Workflow">⏹ Stop</button>
            <button id="btn-resume" title="Resume Workflow">🔄 Resume</button>
            <button id="btn-save" title="Save Workflow">💾 Save</button>
            <button id="btn-validate" title="Validate Workflow">✓ Validate</button>
            <span id="execution-status" class="status-badge"></span>
        </div>
        <div id="main-container">
            <div id="toolbox">
                <div class="toolbox-header">Components</div>
                <div class="toolbox-item" draggable="true" data-type="start">
                    <span class="icon">⬤</span> Start
                </div>
                <div class="toolbox-item" draggable="true" data-type="end">
                    <span class="icon">⬤</span> End
                </div>
                <div class="toolbox-item" draggable="true" data-type="agent">
                    <span class="icon">🤖</span> Agent
                </div>
                <div class="toolbox-item" draggable="true" data-type="condition">
                    <span class="icon">◇</span> Condition
                </div>
                <div class="toolbox-item" draggable="true" data-type="human_approval">
                    <span class="icon">👤</span> Human Approval
                </div>
                <div class="toolbox-item" draggable="true" data-type="delay">
                    <span class="icon">⏱</span> Delay
                </div>
            </div>
            <div id="canvas-container">
                <canvas id="canvas"></canvas>
            </div>
            <div id="properties-panel">
                <div class="properties-header">Properties</div>
                <div id="properties-content">
                    <p class="empty-state">Select a node to edit properties</p>
                </div>
            </div>
        </div>
        <div id="execution-panel" class="hidden">
            <div class="panel-header">
                <span>Execution Log</span>
                <button id="btn-clear-log" title="Clear Log">✕</button>
            </div>
            <div id="execution-log"></div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private postMessage(webview: vscode.Webview, message: any) {
        webview.postMessage(message);
    }
}

/**
 * In-memory workflow document
 */
export class WorkflowDocument implements vscode.CustomDocument {

    static nextId = 1;
    private _workflow: Workflow;
    private _dirty = false;

    public get workflow(): Workflow {
        return this._workflow;
    }

    constructor(
        public readonly uri: vscode.Uri,
        private readonly _onDidChange: vscode.EventEmitter<vscode.CustomDocumentEditEvent<WorkflowDocument>>
    ) {
        this._workflow = {
            name: 'untitled-workflow',
            nodes: [],
            edges: []
        };
    }

    async load(): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(this.uri);
            const yamlStr = Buffer.from(bytes).toString('utf-8');
            this._workflow = yamlToWorkflow(yamlStr);
        } catch {
            // New file - start with empty workflow
            this._workflow.name = this.uri.fsPath.replace(/\.workflow\.yaml$/, '').split('/').pop() || 'untitled-workflow';
        }
        this._dirty = false;
    }

    async fromBackup(backupId: string): Promise<void> {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(backupId));
        const yamlStr = Buffer.from(bytes).toString('utf-8');
        this._workflow = yamlToWorkflow(yamlStr);
        this._dirty = false;
    }

    async save(): Promise<void> {
        const yamlStr = workflowToYaml(this._workflow);
        await vscode.workspace.fs.writeFile(this.uri, Buffer.from(yamlStr, 'utf-8'));
        this._dirty = false;
    }

    async saveAs(targetResource: vscode.Uri): Promise<void> {
        const yamlStr = workflowToYaml(this._workflow);
        await vscode.workspace.fs.writeFile(targetResource, Buffer.from(yamlStr, 'utf-8'));
    }

    async backup(destination: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, Buffer.from(workflowToYaml(this._workflow), 'utf-8'));
    }

    updateWorkflow(workflow: Workflow): void {
        this._workflow = workflow;
        this._dirty = true;
        // Fire change event to notify VS Code the document has been modified
        this._onDidChange.fire({
            document: this,
            undo: () => { /* undo handled by history in webview */ },
            redo: () => { /* redo handled by history in webview */ }
        } as vscode.CustomDocumentEditEvent<WorkflowDocument>);
    }

    get isDirty(): boolean {
        return this._dirty;
    }

    dispose(): void {
        // Cleanup if needed
    }

    // Required events for CustomDocument
    public readonly onDidChangeContent: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    public readonly onDidChangeDocument: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    public readonly onWillDispose: vscode.Event<void> = new vscode.EventEmitter<void>().event;
}
