import * as vscode from 'vscode';
import { WorkflowDesignerProvider } from './designer/workflowDesignerProvider';
import { ProjectDesignerProvider } from './designer/projectDesignerProvider';
import { WorkflowRuntime } from './runtime/workflowRuntime';
import { WorkflowExplorerProvider } from './panels/workflowExplorer';
import {
    registerWorkflowChatParticipant,
    requestWorkflowRunInCopilotChat
} from './chat/workflowChatParticipant';
import { validateWorkflow } from './utils/workflowValidator';
import { Workflow } from './models/workflow';

let runtime: WorkflowRuntime | undefined;
let explorerProvider: WorkflowExplorerProvider | undefined;
let diagnosticsCollection: vscode.DiagnosticCollection | undefined;

export function activate(context: vscode.ExtensionContext) {
    // eslint-disable-next-line no-console
    console.log('Agent Workflow Designer extension is now active!');

    // Register custom editor for workflow files
    const designerProvider = new WorkflowDesignerProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'workflowDesigner.editor',
            designerProvider,
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
        )
    );

    // Register custom editor for project files (multi-workflow)
    const projectProvider = new ProjectDesignerProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'workflowProject.editor',
            projectProvider,
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
        )
    );

    // Initialize runtime
    runtime = new WorkflowRuntime(context);
    context.subscriptions.push(runtime);

    // Create diagnostics collection for validation errors
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('workflowDesigner');
    context.subscriptions.push(diagnosticsCollection);

    // Genuine Copilot subagents require the Chat participant's tool token.
    context.subscriptions.push(registerWorkflowChatParticipant(context, runtime));

    // Wire runtime into designer providers so toolbar buttons work
    designerProvider.setRuntime(runtime);
    designerProvider.setDiagnosticsCollection(diagnosticsCollection);
    projectProvider.setRuntime(runtime);

    // Register workflow explorer
    explorerProvider = new WorkflowExplorerProvider(context);
    context.subscriptions.push(
        vscode.window.createTreeView('workflowExplorer.list', { treeDataProvider: explorerProvider })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('workflowDesigner.newWorkflow', () => {
            vscode.window.showSaveDialog({
                filters: { 'Workflow YAML': ['workflow.yaml'] },
                saveLabel: 'Create Workflow'
            }).then(uri => {
                if (uri) {
                    vscode.workspace.fs.writeFile(uri, Buffer.from(generateEmptyWorkflowYaml()));
                    vscode.commands.executeCommand('vscode.open', uri);
                }
            });
        }),
        vscode.commands.registerCommand('workflowDesigner.newProject', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new project',
                placeHolder: 'my-project',
                validateInput: value => {
                    if (!value || !value.trim()) {return 'Project name is required';}
                    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {return 'Use only letters, numbers, hyphens, and underscores (start with a letter or number)';}
                    return null;
                }
            });
            if (!name) {
                return;
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
                return;
            }

            const folder = workspaceFolders[0];
            const workflowsPath = vscode.Uri.joinPath(folder.uri, '.github', 'workflows');
            const filePath = `${name.trim()}.workflow-project.yaml`;
            const fileUri = vscode.Uri.joinPath(workflowsPath, filePath);

            // Ensure .github/workflows directory exists
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.github'));
                await vscode.workspace.fs.createDirectory(workflowsPath);
            } catch {
                // Directory may already exist
            }

            // Create the project file
            const yamlContent = `name: ${name.trim()}
members: []
`;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(yamlContent));

            // Refresh the explorer tree
            if (explorerProvider) {
                explorerProvider.refresh();
            }

            // Open in the project designer (custom editor)
            await vscode.commands.executeCommand('vscode.openWith', fileUri, 'workflowProject.editor');
        }),
        vscode.commands.registerCommand('workflowDesigner.addWorkflow', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new workflow',
                placeHolder: 'my-workflow',
                validateInput: value => {
                    if (!value || !value.trim()) {return 'Workflow name is required';}
                    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {return 'Use only letters, numbers, hyphens, and underscores (start with a letter or number)';}
                    return null;
                }
            });
            if (!name) {
                return;
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
                return;
            }

            const folder = workspaceFolders[0];
            const workflowsPath = vscode.Uri.joinPath(folder.uri, '.github', 'workflows');
            const filePath = `${name.trim()}.workflow.yaml`;
            const fileUri = vscode.Uri.joinPath(workflowsPath, filePath);

            // Ensure .github/workflows directory exists
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.github'));
                await vscode.workspace.fs.createDirectory(workflowsPath);
            } catch {
                // Directory may already exist
            }

            // Create the workflow file
            const yamlContent = generateEmptyWorkflowYaml(name.trim());
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(yamlContent));

            // Refresh the explorer tree so the new workflow appears
            if (explorerProvider) {
                explorerProvider.refresh();
            }

            // Open in the workflow designer (custom editor)
            await vscode.commands.executeCommand('vscode.openWith', fileUri, 'workflowDesigner.editor');
        }),
        vscode.commands.registerCommand('workflowDesigner.runWorkflow', async () => {
            if (runtime) {
                await requestWorkflowRunInCopilotChat(runtime);
            }
        }),
        vscode.commands.registerCommand('workflowDesigner.pauseWorkflow', () => {
            if (runtime) {runtime.pause();}
        }),
        vscode.commands.registerCommand('workflowDesigner.stopWorkflow', () => {
            if (runtime) {runtime.stop();}
        }),
        vscode.commands.registerCommand('workflowDesigner.resumeWorkflow', () => {
            if (runtime) {runtime.resume();}
        }),
        vscode.commands.registerCommand('workflowDesigner.saveWorkflow', () => {
            vscode.commands.executeCommand('workbench.action.files.save');
        }),
        vscode.commands.registerCommand('workflowDesigner.validateWorkflow', async () => {
            // Trigger save first
            await vscode.commands.executeCommand('workbench.action.files.save');
            // Validate the current workflow and publish diagnostics
            if (runtime && diagnosticsCollection) {
                const doc = vscode.window.activeTextEditor?.document;
                if (doc && doc.uri.fsPath.endsWith('.workflow.yaml')) {
                    const { yamlToWorkflow } = await import('./utils/yamlSerializer');
                    try {
                        const content = await vscode.workspace.fs.readFile(doc.uri);
                        const workflow = yamlToWorkflow(Buffer.from(content).toString('utf-8'));
                        publishValidationDiagnostics(diagnosticsCollection, doc.uri, workflow);
                    } catch {
                        diagnosticsCollection.delete(doc.uri);
                    }
                }
            }
        }),
        vscode.commands.registerCommand('workflowDesigner.exportExecutionLogs', async () => {
            if (!runtime) {
                return;
            }
            const logs = runtime.exportCurrentExecutionLogs();
            const uri = await vscode.window.showSaveDialog({
                filters: { 'Text': ['txt'], 'Log': ['log'] },
                saveLabel: 'Export Logs',
                defaultUri: vscode.Uri.file('workflow-execution-log.txt'),
            });
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(logs, 'utf-8'));
                vscode.window.showInformationMessage(`Execution logs exported to ${uri.fsPath}`);
            } {
            }
        }),
        vscode.commands.registerCommand('workflowDesigner.addWorkflowToProject', async (treeItem?: any) => {
            // Discover available workflow files in .github/workflows/
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            const folder = workspaceFolders[0];
            const workflowsPath = vscode.Uri.joinPath(folder.uri, '.github', 'workflows');

            const workflowFiles: { label: string; path: string; uri: vscode.Uri }[] = [];
            try {
                const entries = await vscode.workspace.fs.readDirectory(workflowsPath);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.File && name.endsWith('.workflow.yaml') && !name.endsWith('.workflow-project.yaml')) {
                        workflowFiles.push({
                            label: name.replace('.workflow.yaml', ''),
                            path: `./${name}`,
                            uri: vscode.Uri.joinPath(workflowsPath, name)
                        });
                    }
                }
            } catch {
                vscode.window.showErrorMessage('Could not read workflows directory.');
                return;
            }

            if (workflowFiles.length === 0) {
                vscode.window.showInformationMessage('No workflow files found. Create a workflow first.');
                return;
            }

            // Quick pick to select workflow(s) to add
            const selected = await vscode.window.showQuickPick(
                workflowFiles.map(wf => ({
                    label: wf.label,
                    description: wf.path,
                    detail: wf.uri.fsPath
                })),
                {
                    placeHolder: 'Select workflows to add to the project',
                    canPickMany: true
                }
            );

            if (!selected || selected.length === 0) {
                return;
            }

            // Determine project URI: prefer label from context menu tree item, then fall back to quick pick
            let projectUri: vscode.Uri | undefined;

            // Context menu passes the tree item label (project name without extension)
            // We use this to find the corresponding .workflow-project.yaml file
            if (treeItem && treeItem.label) {
                const projectName = treeItem.label;
                const candidateUri = vscode.Uri.joinPath(workflowsPath, `${projectName}.workflow-project.yaml`);
                try {
                    await vscode.workspace.fs.stat(candidateUri);
                    projectUri = candidateUri;
                } catch {
                    // File doesn't exist, fall through to quick pick
                }
            }

            // Last resort: prompt to select one
            if (!projectUri) {
                const projectFiles: vscode.Uri[] = [];
                try {
                    const entries = await vscode.workspace.fs.readDirectory(workflowsPath);
                    for (const [name, type] of entries) {
                        if (type === vscode.FileType.File && name.endsWith('.workflow-project.yaml')) {
                            projectFiles.push(vscode.Uri.joinPath(workflowsPath, name));
                        }
                    }
                } catch { /* ignore */ }

                if (projectFiles.length === 0) {
                    vscode.window.showInformationMessage('No project files found. Create a project first.');
                    return;
                }

                const pickedProject = await vscode.window.showQuickPick(
                    projectFiles.map(p => ({
                        label: p.fsPath.replace(/.*\//, '').replace('.workflow-project.yaml', ''),
                        uri: p
                    })),
                    { placeHolder: 'Select a project to add workflows to' }
                );
                if (!pickedProject) {
                    return;
                }
                projectUri = pickedProject.uri;
            }

            // Read current project
            const { yamlToProject, projectToYaml } = await import('./utils/projectSerializer');
            const project = yamlToProject(Buffer.from(await vscode.workspace.fs.readFile(projectUri)).toString('utf-8'));

            // Add selected workflows (skip duplicates)
            // VS Code only preserves standard QuickPickItem properties, so match by label back to workflowFiles
            let addedCount = 0;
            for (const item of selected) {
                const wf = workflowFiles.find(w => w.label === item.label);
                if (!wf) continue;
                if (!project.members.find(m => m.path === wf.path)) {
                    const position = { x: project.members.length * 400, y: 0 };
                    project.members.push({ path: wf.path, position });
                    addedCount++;
                }
            }

            // Save updated project
            await vscode.workspace.fs.writeFile(projectUri, Buffer.from(projectToYaml(project), 'utf-8'));
            if (explorerProvider) {
                explorerProvider.refresh();
            }
            vscode.window.showInformationMessage(`Added ${addedCount} workflow(s) to '${project.name}'.`);
        }),
        vscode.commands.registerCommand('workflowDesigner.removeWorkflowFromProject', async (treeItem?: any) => {
            // Determine project URI: prefer label from context menu tree item
            let projectUri: vscode.Uri | undefined;

            // Context menu passes the tree item label (project name without extension)
            if (treeItem && treeItem.label) {
                const projectName = treeItem.label;
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const workflowsPath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'workflows');
                    const candidateUri = vscode.Uri.joinPath(workflowsPath, `${projectName}.workflow-project.yaml`);
                    try {
                        await vscode.workspace.fs.stat(candidateUri);
                        projectUri = candidateUri;
                    } catch {
                        // File doesn't exist, fall through to quick pick
                    }
                }
            }

            if (!projectUri) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    return;
                }
                const workflowsPath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'workflows');
                const projectFiles: vscode.Uri[] = [];
                try {
                    const entries = await vscode.workspace.fs.readDirectory(workflowsPath);
                    for (const [name, type] of entries) {
                        if (type === vscode.FileType.File && name.endsWith('.workflow-project.yaml')) {
                            projectFiles.push(vscode.Uri.joinPath(workflowsPath, name));
                        }
                    }
                } catch { /* ignore */ }

                if (projectFiles.length === 0) {
                    vscode.window.showInformationMessage('No project files found.');
                    return;
                }

                const pickedProject = await vscode.window.showQuickPick(
                    projectFiles.map(p => ({
                        label: p.fsPath.replace(/.*\//, '').replace('.workflow-project.yaml', ''),
                        uri: p
                    })),
                    { placeHolder: 'Select a project to remove workflows from' }
                );
                if (!pickedProject) {
                    return;
                }
                projectUri = pickedProject.uri;
            }

            // Read current project
            const { yamlToProject, projectToYaml } = await import('./utils/projectSerializer');
            const project = yamlToProject(Buffer.from(await vscode.workspace.fs.readFile(projectUri)).toString('utf-8'));

            if (project.members.length === 0) {
                vscode.window.showInformationMessage('This project has no workflows to remove.');
                return;
            }

            // Quick pick to select workflow(s) to remove
            const selected = await vscode.window.showQuickPick(
                project.members.map(m => ({
                    label: m.path.replace('.workflow.yaml', '').replace('./', ''),
                    description: m.path,
                    path: m.path
                })),
                {
                    placeHolder: 'Select workflows to remove from the project',
                    canPickMany: true
                }
            );

            if (!selected || selected.length === 0) {
                return;
            }

            // Remove selected workflows
            const pathsToRemove = new Set((selected as any[]).map(s => s.path));
            project.members = project.members.filter(m => !pathsToRemove.has(m.path));

            // Save updated project
            await vscode.workspace.fs.writeFile(projectUri, Buffer.from(projectToYaml(project), 'utf-8'));
            if (explorerProvider) {
                explorerProvider.refresh();
            }
            vscode.window.showInformationMessage(`Removed ${selected.length} workflow(s) from '${project.name}'.`);
        }),
        vscode.commands.registerCommand('workflowDesigner.listModels', async () => {
            try {
                const models = await vscode.lm.selectChatModels();
                const output = vscode.window.createOutputChannel('Available Models');
                output.clear();
                output.show();
                if (models.length === 0) {
                    output.appendLine('No language models available.');
                } else {
                    output.appendLine(`Found ${models.length} model(s):`);
                    for (const m of models) {
                        output.appendLine(`  - ${m.name} (${m.vendor}) [id: ${m.id}]`);
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to list models: ${error}`);
            }
        })
    );
}

function generateEmptyWorkflowYaml(name: string = 'new-workflow'): string {
    return `name: ${name}
description: A new workflow
nodes:
  - id: start
    type: start
    position:
      x: 200
      y: 100
    data:
      label: Start
  - id: end
    type: end
    position:
      x: 200
      y: 300
    data:
      label: End
      summary: true
edges:
  - source: start
    target: end
`;
}

/**
 * Map validation errors from the validator to VS Code Diagnostics
 * and publish them to the Problems panel.
 */
function publishValidationDiagnostics(
    collection: vscode.DiagnosticCollection,
    uri: vscode.Uri,
    workflow: Workflow
): void {
    const errors = validateWorkflow(workflow);
    const diagnostics: vscode.Diagnostic[] = [];

    // Build a map of node id -> line number in the YAML file
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
    const text = document.getText();
    const lines = text.split('\n');
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
    const text = document.getText();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith(`id: ${edgeId}`)) {
            return i;
        }
    }
    return null;
}

export function deactivate() {
    if (runtime) {
        runtime.stop();
    }
}
