import * as vscode from 'vscode';
import { WorkflowDesignerProvider } from './designer/workflowDesignerProvider';
import { WorkflowRuntime } from './runtime/workflowRuntime';
import { WorkflowExplorerProvider } from './panels/workflowExplorer';

let runtime: WorkflowRuntime | undefined;

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

    // Register workflow explorer
    const explorerProvider = new WorkflowExplorerProvider(context);
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
        })
    );
}

function generateEmptyWorkflowYaml(): string {
    return `name: new-workflow
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
