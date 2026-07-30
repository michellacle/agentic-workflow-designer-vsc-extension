import * as vscode from 'vscode';
import { Project, Workflow } from '../models/workflow';
import { projectToYaml, yamlToProject } from '../utils/projectSerializer';
import { workflowToYaml, yamlToWorkflow } from '../utils/yamlSerializer';
import { WorkflowRuntime } from '../runtime/workflowRuntime';
import { ExecutionStateChangeEvent } from '../runtime/workflowExecutor';

/**
 * Custom editor provider for Project (multi-workflow) designer.
 * Opens a `*.workflow-project.yaml` file and renders all member workflows
 * on a shared canvas with group containers.
 */
export class ProjectDesignerProvider implements vscode.CustomEditorProvider<ProjectDocument> {

    public static readonly viewType = 'workflowProject.editor';
    private readonly webviews: Map<string, vscode.Webview> = new Map();
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ProjectDocument>>();
    private runtime: WorkflowRuntime | undefined;

    constructor(private readonly context: vscode.ExtensionContext) { }

    setRuntime(runtime: WorkflowRuntime): void {
        this.runtime = runtime;
        runtime.onDidChangeExecutionState((status: ExecutionStateChangeEvent) => {
            for (const webview of this.webviews.values()) {
                webview.postMessage({
                    type: 'executionUpdate',
                    status
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
    ): Promise<ProjectDocument> {
        const document = new ProjectDocument(uri, this._onDidChangeCustomDocument);

        if (openContext.backupId) {
            await document.fromBackup(openContext.backupId);
        } else {
            await document.load();
        }

        return document;
    }

    async resolveCustomEditor(
        document: ProjectDocument,
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

        // Send initial project data with all member workflows
        const agentFiles = await this.getAgentFiles();
        const config = vscode.workspace.getConfiguration('workflowDesigner.animation');
        const animationConfig = {
            startNodeFlashMs: config.get<number>('startNodeFlashMs', 3000),
            edgeHandoffMs: config.get<number>('edgeHandoffMs', 3000),
            endNodeFlashMs: config.get<number>('endNodeFlashMs', 1200),
            edgeDashSpeed: config.get<number>('edgeDashSpeed', 20)
        };

        this.postMessage(webviewPanel.webview, {
            type: 'initProject',
            project: document.project,
            workflows: document.workflows,
            agentFiles,
            animationConfig
        });

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'updateWorkflow':
                    // A single workflow within the project was modified
                    document.updateWorkflow(msg.workflowId, msg.workflow);
                    break;
                case 'updateProject':
                    // Project membership or positions changed
                    document.updateProject(msg.project);
                    break;
                case 'save':
                    await document.save();
                    break;
                case 'run':
                    // Run a specific workflow from the project
                    if (this.runtime && msg.workflowId && msg.workflow) {
                        // Find the workflow file URI
                        const memberUri = document.getMemberUri(msg.workflowId);
                        if (memberUri) {
                            this.runtime.setCurrentWorkflow(msg.workflow, memberUri);
                        }
                    }
                    await vscode.commands.executeCommand('workflowDesigner.runWorkflow');
                    break;
                case 'pause':
                    if (this.runtime) { this.runtime.pause(); }
                    break;
                case 'stop':
                    if (this.runtime) { this.runtime.stop(); }
                    break;
                case 'resume':
                    if (this.runtime) { this.runtime.resume(); }
                    break;
                case 'error':
                case 'showError':
                    vscode.window.showErrorMessage(`Project Designer: ${msg.message}`);
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(msg.message);
                    break;
            }
        });

        webviewPanel.onDidDispose(() => {
            this.webviews.delete(document.uri.toString());
        });
    }

    async saveCustomDocument(document: ProjectDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        await document.save();
    }

    async saveCustomDocumentAs(document: ProjectDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        await document.saveAs(destination);
    }

    async revertCustomDocument(document: ProjectDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        await document.load();
    }

    async backupCustomDocument(document: ProjectDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await document.backup(context.destination);
        return {
            id: context.destination.fsPath,
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch { /* ignore */ }
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
    <title>Project Designer</title>
</head>
<body>
    <div id="app">
        <div id="toolbar">
            <button id="btn-save" title="Save Project">💾</button>
            <button id="btn-edit-mode" title="Toggle Edit Mode">✎</button>
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
                <div class="toolbox-header toolbox-section-divider">Annotations</div>
                <div class="toolbox-item toolbox-item-annotation" draggable="true" data-type="label">
                    <span class="icon">T</span> Label
                </div>
                <div class="toolbox-item toolbox-item-annotation" draggable="true" data-type="note">
                    <span class="icon">📝</span> Note
                </div>
                <div class="toolbox-item toolbox-item-annotation" draggable="true" data-type="process">
                    <span class="icon">⚙</span> Process
                </div>
                <div class="toolbox-item toolbox-item-annotation" draggable="true" data-type="decision">
                    <span class="icon">⬡</span> Decision
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

    private postMessage(webview: vscode.Webview, message: unknown) {
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
 * In-memory Project document. Loads the project file and all member workflows.
 */
export class ProjectDocument implements vscode.CustomDocument {

    private _project: Project;
    private _workflows: Map<string, Workflow> = new Map();
    private _dirty = false;

    public get project(): Project {
        return this._project;
    }

    public get workflows(): Map<string, Workflow> {
        return this._workflows;
    }

    constructor(
        public readonly uri: vscode.Uri,
        private readonly _onDidChange: vscode.EventEmitter<vscode.CustomDocumentEditEvent<ProjectDocument>>
    ) {
        this._project = {
            name: 'untitled-project',
            members: []
        };
    }

    async load(): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(this.uri);
            const yamlStr = Buffer.from(bytes).toString('utf-8');
            this._project = yamlToProject(yamlStr);
        } catch {
            this._project.name = this.uri.fsPath.replace(/\.workflow-project\.yaml$/, '').split('/').pop() || 'untitled-project';
        }
        await this.loadMemberWorkflows();
        this._dirty = false;
    }

    async fromBackup(backupId: string): Promise<void> {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(backupId));
        const yamlStr = Buffer.from(bytes).toString('utf-8');
        this._project = yamlToProject(yamlStr);
        await this.loadMemberWorkflows();
        this._dirty = false;
    }

    /**
     * Resolve a relative member path to an absolute URI.
     */
    private resolveMemberPath(relativePath: string): vscode.Uri {
        const projectDir = vscode.Uri.joinPath(this.uri, '..');
        const normalized = relativePath.replace(/^\.\//, '');
        return vscode.Uri.joinPath(projectDir, normalized);
    }

    /**
     * Load all member workflow files into memory.
     */
    private async loadMemberWorkflows(): Promise<void> {
        this._workflows.clear();
        for (const member of this._project.members) {
            try {
                const memberUri = this.resolveMemberPath(member.path);
                const bytes = await vscode.workspace.fs.readFile(memberUri);
                const yamlStr = Buffer.from(bytes).toString('utf-8');
                const workflow = yamlToWorkflow(yamlStr);
                this._workflows.set(member.path, workflow);
            } catch {
                // Member workflow file not found — skip silently
            }
        }
    }

    async save(): Promise<void> {
        // Save the project file
        const projectYaml = projectToYaml(this._project);
        await vscode.workspace.fs.writeFile(this.uri, Buffer.from(projectYaml, 'utf-8'));

        // Save each modified member workflow
        for (const [path, workflow] of this._workflows) {
            const memberUri = this.resolveMemberPath(path);
            const workflowYaml = workflowToYaml(workflow);
            await vscode.workspace.fs.writeFile(memberUri, Buffer.from(workflowYaml, 'utf-8'));
        }

        this._dirty = false;
    }

    async saveAs(targetResource: vscode.Uri): Promise<void> {
        const projectYaml = projectToYaml(this._project);
        await vscode.workspace.fs.writeFile(targetResource, Buffer.from(projectYaml, 'utf-8'));
    }

    async backup(destination: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, Buffer.from(projectToYaml(this._project), 'utf-8'));
    }

    /**
     * Update a member workflow in memory.
     */
    updateWorkflow(workflowId: string, workflow: Workflow): void {
        this._workflows.set(workflowId, workflow);
        this._dirty = true;
        this._onDidChange.fire({
            document: this,
            undo: () => { /* undo handled by history in webview */ },
            redo: () => { /* redo handled by history in webview */ }
        } as vscode.CustomDocumentEditEvent<ProjectDocument>);
    }

    /**
     * Update project membership or positions.
     */
    updateProject(project: Project): void {
        this._project = project;
        this._dirty = true;
        this._onDidChange.fire({
            document: this,
            undo: () => { /* undo handled by history in webview */ },
            redo: () => { /* redo handled by history in webview */ }
        } as vscode.CustomDocumentEditEvent<ProjectDocument>);
    }

    /**
     * Get the file URI for a project member by path.
     */
    getMemberUri(path: string): vscode.Uri | undefined {
        const member = this._project.members.find(m => m.path === path);
        if (!member) return undefined;
        return this.resolveMemberPath(member.path);
    }

    get isDirty(): boolean {
        return this._dirty;
    }

    dispose(): void {
        this._workflows.clear();
    }

    public readonly onDidChangeContent: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    public readonly onDidChangeDocument: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    public readonly onWillDispose: vscode.Event<void> = new vscode.EventEmitter<void>().event;
}
