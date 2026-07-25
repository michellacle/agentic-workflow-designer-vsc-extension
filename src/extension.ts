import * as vscode from 'vscode';
import { WorkflowDesignerProvider } from './designer/workflowDesignerProvider';
import { WorkflowRuntime } from './runtime/workflowRuntime';
import { WorkflowExplorerProvider } from './panels/workflowExplorer';
import {
    registerWorkflowChatParticipant,
    requestWorkflowRunInCopilotChat
} from './chat/workflowChatParticipant';
import { validateWorkflow, ValidationError } from './utils/workflowValidator';
import { Workflow, NodeType } from './models/workflow';

let runtime: WorkflowRuntime | undefined;
let explorerProvider: WorkflowExplorerProvider | undefined;
let diagnosticsCollection: vscode.DiagnosticCollection | undefined;

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

    // Create diagnostics collection for validation errors
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('workflowDesigner');
    context.subscriptions.push(diagnosticsCollection);

    // Genuine Copilot subagents require the Chat participant's tool token.
    context.subscriptions.push(registerWorkflowChatParticipant(context, runtime));

    // Wire runtime into designer provider so toolbar buttons work
    designerProvider.setRuntime(runtime);
    designerProvider.setDiagnosticsCollection(diagnosticsCollection);

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
        vscode.commands.registerCommand('workflowDesigner.runWorkflow', async () => {
            if (runtime) {
                await requestWorkflowRunInCopilotChat(runtime);
            }
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
            if (!runtime) return;
            const logs = runtime.exportCurrentExecutionLogs();
            const uri = await vscode.window.showSaveDialog({
                filters: { 'Text': ['txt'], 'Log': ['log'] },
                saveLabel: 'Export Logs',
                defaultUri: vscode.Uri.file('workflow-execution-log.txt'),
            });
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(logs, 'utf-8'));
                vscode.window.showInformationMessage(`Execution logs exported to ${uri.fsPath}`);
            }
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
nodes: []
edges: []
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
    const nodeLineMap = buildNodeLineMap(document, workflow);

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

/**
 * Build a map of node id -> approximate line for positioning diagnostics.
 */
function buildNodeLineMap(document: vscode.TextDocument | undefined, workflow: Workflow): Map<string, number> {
    const map = new Map<string, number>();
    if (!document) return map;
    const lines = document.getText().split('\n');
    for (const node of workflow.nodes) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().includes(`id: ${node.id}`)) {
                map.set(node.id, i);
                break;
            }
        }
    }
    return map;
}

export function deactivate() {
    if (runtime) {
        runtime.stop();
    }
}
