import * as vscode from 'vscode';
import { WorkflowDesignerProvider } from './designer/workflowDesignerProvider';
import { WorkflowRuntime } from './runtime/workflowRuntime';
import { WorkflowExplorerProvider } from './panels/workflowExplorer';

let runtime: WorkflowRuntime | undefined;
let explorerProvider: WorkflowExplorerProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
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

    // Initialize runtime
    runtime = new WorkflowRuntime(context);
    context.subscriptions.push(runtime);

    // Wire runtime into designer provider so toolbar buttons work
    designerProvider.setRuntime(runtime);

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
        vscode.commands.registerCommand('workflowDesigner.addWorkflow', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new workflow',
                placeHolder: 'my-workflow',
                validateInput: value => {
                    if (!value || !value.trim()) return 'Workflow name is required';
                    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) return 'Use only letters, numbers, hyphens, and underscores (start with a letter or number)';
                    return null;
                }
            });
            if (!name) return;

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
        vscode.commands.registerCommand('workflowDesigner.runWorkflow', () => {
            if (runtime) runtime.runCurrentWorkflow();
        }),
        vscode.commands.registerCommand('workflowDesigner.pauseWorkflow', () => {
            if (runtime) runtime.pause();
        }),
        vscode.commands.registerCommand('workflowDesigner.stopWorkflow', () => {
            if (runtime) runtime.stop();
        }),
        vscode.commands.registerCommand('workflowDesigner.resumeWorkflow', () => {
            if (runtime) runtime.resume();
        }),
        vscode.commands.registerCommand('workflowDesigner.saveWorkflow', () => {
            vscode.commands.executeCommand('workbench.action.files.save');
        }),
        vscode.commands.registerCommand('workflowDesigner.validateWorkflow', () => {
            vscode.commands.executeCommand('workbench.action.files.save');
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
                        output.appendLine(`  - ${m.id} (vendor: ${m.vendor})`);
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
      x: 100
      y: 100
  - id: end
    type: end
    position:
      x: 100
      y: 300
edges:
  - source: start
    target: end
`;
}

export function deactivate() {
    if (runtime) {
        runtime.stop();
    }
}
