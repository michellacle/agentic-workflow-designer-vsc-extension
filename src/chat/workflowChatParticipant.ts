import * as vscode from 'vscode';
import { ExecutionStatus } from '../models/workflow';
import { WorkflowRuntime } from '../runtime/workflowRuntime';

export const WORKFLOW_CHAT_PARTICIPANT_ID = 'workflowDesigner.workflow';
const WORKFLOW_CHAT_PARTICIPANT_NAME = 'workflow';

/**
 * Register the Copilot Chat entry point that owns the tool invocation token
 * required by VS Code's genuine runSubagent tool.
 */
export function registerWorkflowChatParticipant(
    context: vscode.ExtensionContext,
    runtime: WorkflowRuntime
): vscode.ChatParticipant {
    const handler: vscode.ChatRequestHandler = async (
        request,
        _chatContext,
        stream,
        cancellationToken
    ): Promise<vscode.ChatResult> => {
        if (request.command !== 'run') {
            stream.markdown('Use `@workflow /run` to execute the workflow currently open in the visual designer.');
            return {};
        }

        if (!runtime.hasCurrentWorkflow()) {
            const message = 'No workflow is loaded. Open a `.workflow.yaml` file in the visual designer and run it again.';
            stream.markdown(message);
            return { errorDetails: { message } };
        }

        const workflowName = runtime.getCurrentWorkflowName() || 'workflow';
        stream.progress(`Starting **${workflowName}** with genuine GitHub Copilot subagents...`);

        const status = await runtime.runCurrentWorkflow({
            toolInvocationToken: request.toolInvocationToken,
            cancellationToken,
            reportProgress: message => stream.progress(message)
        });

        switch (status) {
            case ExecutionStatus.Completed:
                stream.markdown(`\n\n✅ Workflow **${workflowName}** completed successfully.`);
                return { metadata: { workflowName, status } };
            case ExecutionStatus.Stopped:
                stream.markdown(`\n\n⏹ Workflow **${workflowName}** was stopped.`);
                return { metadata: { workflowName, status } };
            case ExecutionStatus.Failed: {
                const message = `Workflow **${workflowName}** failed. See the Workflow Executor output channel for node-level details.`;
                stream.markdown(`\n\n❌ ${message}`);
                return {
                    errorDetails: { message },
                    metadata: { workflowName, status }
                };
            }
            default: {
                const message = `Workflow **${workflowName}** did not start. Check workflow validation and the Workflow Executor output channel.`;
                stream.markdown(`\n\n⚠️ ${message}`);
                return {
                    errorDetails: { message },
                    metadata: { workflowName, status: status || 'not-started' }
                };
            }
        }
    };

    const participant = vscode.chat.createChatParticipant(
        WORKFLOW_CHAT_PARTICIPANT_ID,
        handler
    );
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'workflow-icon.svg');
    return participant;
}

/**
 * Hand the visual Run action to Copilot Chat. isPartialQuery=false submits the
 * participant request immediately, which gives the handler a valid tool token.
 */
export async function requestWorkflowRunInCopilotChat(
    runtime: WorkflowRuntime
): Promise<void> {
    if (!runtime.hasCurrentWorkflow()) {
        vscode.window.showWarningMessage('No workflow loaded. Open a .workflow.yaml file first.');
        return;
    }

    await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@${WORKFLOW_CHAT_PARTICIPANT_NAME} /run`,
        isPartialQuery: false
    });
}
