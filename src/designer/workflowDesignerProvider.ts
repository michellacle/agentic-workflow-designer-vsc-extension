import * as vscode from 'vscode';
import { Workflow } from '../models/workflow';
import { workflowToYaml, yamlToWorkflow } from '../utils/yamlSerializer';
import { WorkflowRuntime } from '../runtime/workflowRuntime';
import { ExecutionStateChangeEvent } from '../runtime/workflowExecutor';
import { validateWorkflow } from '../utils/workflowValidator';

/**
 * Custom editor provider for workflow designer
 */
export class WorkflowDesignerProvider implements vscode.CustomEditorProvider<WorkflowDocument> {

    public static readonly viewType = 'workflowDesigner.editor';
    private readonly webviews: Map<string, vscode.Webview> = new Map();
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<WorkflowDocument>>();
    private runtime: WorkflowRuntime | undefined;
    private diagnosticsCollection: vscode.DiagnosticCollection | undefined;

    constructor(private readonly context: vscode.ExtensionContext) { }

    setRuntime(runtime: WorkflowRuntime): void {
        this.runtime = runtime;
        // Subscribe to execution state changes and forward to all webviews
        runtime.onDidChangeExecutionState((status: ExecutionStateChangeEvent) => {
            for (const webview of this.webviews.values()) {
                webview.postMessage({
                    type: 'executionUpdate',
                    status
                });
            }
        });
    }

    setDiagnosticsCollection(collection: vscode.DiagnosticCollection): void {
        this.diagnosticsCollection = collection;
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
        const agentFiles = await this.getAgentFiles();
        this.postMessage(webviewPanel.webview, {
            type: 'init',
            workflow: document.workflow,
            agentFiles: agentFiles
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
                    }
                    await vscode.commands.executeCommand('workflowDesigner.runWorkflow');
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
                case 'showError':
                    vscode.window.showErrorMessage(`Workflow Designer: ${msg.message}`);
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(msg.message);
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
                    // Publish diagnostics to Problems panel
                    publishValidationDiagnostics(this.diagnosticsCollection, document.uri, document.workflow);
                    break;
                case 'editEdgeLabel':
                    // Show input box for edge label editing
                    const currentLabel = msg.currentLabel || '';
                    const newLabel = await vscode.window.showInputBox({
                        prompt: 'Enter edge label',
                        value: currentLabel,
                        placeHolder: 'e.g., True, False, Pass, Fail'
                    });
                    if (newLabel !== undefined) {
                        // Find and update the edge in the workflow
                        const edge = document.workflow.edges.find(e => e.id === msg.edgeId);
                        if (edge) {
                            edge.label = newLabel;
                            // Notify webview of the update
                            webviewPanel.webview.postMessage({
                                type: 'edgeLabelUpdate',
                                edgeId: msg.edgeId,
                                newLabel
                            });
                        }
                    }
                    break;
            }
        });

        webviewPanel.onDidDispose(() => {
            this.webviews.delete(document.uri.toString());
            // Clear diagnostics when editor is closed
            if (this.diagnosticsCollection) {
                this.diagnosticsCollection.delete(document.uri);
            }
        });
    }

    async saveCustomDocument(document: WorkflowDocument, cancellation: vscode.CancellationToken): Promise<void> {
        await document.save();
        // Publish validation diagnostics on save
        publishValidationDiagnostics(this.diagnosticsCollection, document.uri, document.workflow);
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
            <button id="btn-edit-mode" title="Toggle Edit Mode (enable/disable editing)">✎ Edit</button>
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
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private postMessage(webview: vscode.Webview, message: any) {
        webview.postMessage(message);
    }

    private async getAgentFiles(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        const agentsPath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'agents');
        try {
            const files = await vscode.workspace.fs.readDirectory(agentsPath);
            return files
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.agent.md'))
                .map(([name]) => name.replace('.agent.md', ''));
        } catch {
            return [];
        }
    }
}

/**
 * Publish validation errors as VS Code Diagnostics to the Problems panel.
 */
function publishValidationDiagnostics(
    collection: vscode.DiagnosticCollection | undefined,
    uri: vscode.Uri,
    workflow: Workflow
): void {
    if (!collection) return;

    const errors = validateWorkflow(workflow);
    const diagnostics: vscode.Diagnostic[] = [];

    // Try to get the text document for line-level resolution
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());

    for (const error of errors) {
        const severity = error.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;

        let range: vscode.Range | undefined;

        // Try to locate the error in the YAML file
        if (error.node && document) {
            const line = findNodeInDocument(document, error.node);
            if (line !== null) {
                range = new vscode.Range(line, 0, line, 0);
            }
        } else if (error.edge && document) {
            const line = findEdgeInDocument(document, error.edge);
            if (line !== null) {
                range = new vscode.Range(line, 0, line, 0);
            }
        }

        if (range) {
            diagnostics.push(new vscode.Diagnostic(range, error.message, severity));
        } else {
            // Global errors go to the top of the file
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                error.message,
                severity
            ));
        }
    }

    collection.set(uri, diagnostics);
}

/**
 * Find the line number where a node with the given id is defined in the YAML.
 */
function findNodeInDocument(document: vscode.TextDocument, nodeId: string): number | null {
    const lines = document.getText().split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith(`id: ${nodeId}`) || lines[i].trim() === `- id: ${nodeId}`) {
            return i;
        }
    }
    return null;
}

/**
 * Find the line number where an edge with the given id is defined in the YAML.
 */
function findEdgeInDocument(document: vscode.TextDocument, edgeId: string): number | null {
    const lines = document.getText().split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith(`id: ${edgeId}`)) {
            return i;
        }
    }
    return null;
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
