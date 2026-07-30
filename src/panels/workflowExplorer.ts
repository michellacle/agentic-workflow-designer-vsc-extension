import * as vscode from 'vscode';

/**
 * Tree provider for the Workflow Explorer view
 */
export class WorkflowExplorerProvider implements vscode.TreeDataProvider<WorkflowTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkflowTreeItem | undefined | void> = new vscode.EventEmitter<WorkflowTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkflowTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkflowTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: WorkflowTreeItem): Thenable<WorkflowTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {return Promise.resolve([]);}

        // If element is a workspace folder, show workflow files
        if (element && element.kind === 'folder') {
            return this.getWorkflowsInFolder(element.folderUri);
        }

        // If element is a workflows directory, show files
        if (element && element.kind === 'workflowsDir') {
            return this.getWorkflowsInFolder(element.folderUri);
        }

        // Root level: show workspace folders with .github/workflows/
        return Promise.resolve(this.getRootItems(workspaceFolders));
    }

    private async getRootItems(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<WorkflowTreeItem[]> {
        const items: WorkflowTreeItem[] = [];

        for (const wf of workspaceFolders) {
            const workflowsPath = vscode.Uri.joinPath(wf.uri, '.github', 'workflows');
            try {
                await vscode.workspace.fs.stat(workflowsPath);
                items.push(new WorkflowTreeItem(
                    wf.name,
                    'folder',
                    wf.uri,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            } catch {
                // .github/workflows doesn't exist yet
                items.push(new WorkflowTreeItem(
                    `${wf.name} (no workflows)`,
                    'folder',
                    wf.uri,
                    vscode.TreeItemCollapsibleState.None
                ));
            }
        }

        return items;
    }

    private async getWorkflowsInFolder(folderUri: vscode.Uri): Promise<WorkflowTreeItem[]> {
        const workflowsPath = vscode.Uri.joinPath(folderUri, '.github', 'workflows');
        const items: WorkflowTreeItem[] = [];

        // Add Workflows section header
        items.push(new WorkflowTreeItem(
            'WORKFLOWS',
            'sectionHeader',
            folderUri,
            vscode.TreeItemCollapsibleState.None
        ));

        try {
            const entries = await vscode.workspace.fs.readDirectory(workflowsPath);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.workflow.yaml') && !name.endsWith('.workflow-project.yaml')) {
                    const uri = vscode.Uri.joinPath(workflowsPath, name);
                    items.push(new WorkflowTreeItem(
                        name.replace('.workflow.yaml', ''),
                        'workflow',
                        uri,
                        vscode.TreeItemCollapsibleState.None
                    ));
                }
            }
        } catch {
            // Directory doesn't exist
        }

        // Add Projects section header
        items.push(new WorkflowTreeItem(
            'PROJECTS',
            'sectionHeader',
            folderUri,
            vscode.TreeItemCollapsibleState.None
        ));

        try {
            const entries = await vscode.workspace.fs.readDirectory(workflowsPath);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.workflow-project.yaml')) {
                    const uri = vscode.Uri.joinPath(workflowsPath, name);
                    items.push(new WorkflowTreeItem(
                        name.replace('.workflow-project.yaml', ''),
                        'project',
                        uri,
                        vscode.TreeItemCollapsibleState.None
                    ));
                }
            }
        } catch {
            // Directory doesn't exist
        }

        return items;
    }
}

class WorkflowTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly kind: 'folder' | 'workflow' | 'project' | 'workflowsDir' | 'sectionHeader',
        public readonly folderUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        this.tooltip = this.label;
        this.contextValue = kind;

        if (kind === 'workflow') {
            this.command = {
                command: 'vscode.openWith',
                title: 'Open Workflow',
                arguments: [folderUri, 'workflowDesigner.editor']
            };
            this.iconPath = new vscode.ThemeIcon('layers');
        } else if (kind === 'project') {
            this.command = {
                command: 'vscode.openWith',
                title: 'Open Project',
                arguments: [folderUri, 'workflowProject.editor']
            };
            this.iconPath = new vscode.ThemeIcon('library');
        } else if (kind === 'sectionHeader') {
            this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}
