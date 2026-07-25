import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NodeExecutionRecord } from '../models/workflow';
import { CopilotSubagentExecutionContext } from './executionContext';

interface AgentInvocationResult {
    success: boolean;
    output: string;
    filesModified?: string[];
}

/**
 * Invokes VS Code custom agents as genuine GitHub Copilot subagents.
 *
 * The runSubagent tool requires a ChatParticipant request context. This class
 * deliberately has no direct Language Model API fallback: an Agent workflow
 * node either runs as the configured Copilot custom agent or fails clearly.
 */
export class AgentInvoker {

    /**
     * Discover agents in the .github/agents/ directory.
     */
    async discoverAgents(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
        const agentsDir = path.join(workspaceFolder.uri.fsPath, '.github', 'agents');
        const agents: string[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(agentsDir));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.agent.md')) {
                    agents.push(name.replace('.agent.md', ''));
                }
            }
        } catch {
            // Directory does not exist yet.
        }

        return agents;
    }

    /**
     * Parse the fields needed to resolve a custom agent.
     *
     * VS Code itself loads and applies the agent's instructions, tools, hooks,
     * and model configuration when runSubagent is invoked with agentName.
     */
    async parseAgentFile(agentPath: string): Promise<{ name: string; description?: string }> {
        const content = fs.readFileSync(agentPath, 'utf-8');
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const frontmatter = frontmatterMatch ? this.parseFrontmatter(frontmatterMatch[1]) : {};

        return {
            name: frontmatter.name || path.basename(agentPath, '.agent.md'),
            description: frontmatter.description
        };
    }

    /**
     * Invoke a custom agent through VS Code's genuine runSubagent tool.
     */
    async invokeAgent(
        agentPath: string,
        prompt: string,
        context: Record<string, unknown>,
        timeout: number,
        modelHint: string | undefined,
        executionContext: CopilotSubagentExecutionContext,
        record?: NodeExecutionRecord,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void,
        stateWrites?: Array<{ source: string; target: string }>
    ): Promise<AgentInvocationResult> {
        const startTime = Date.now();

        try {
            // Condition nodes pass an empty agentPath — use general agent instead
            let agentName: string;
            if (!agentPath) {
                agentName = 'general';
            } else {
                const agentConfig = await this.parseAgentFile(agentPath);
                agentName = agentConfig.name;
            }

            if (record) {
                record.prompt = prompt;
                record.contextIn = context;
                record.logs?.push(`Invoking genuine Copilot subagent: ${agentName}`);
            }

            const subagentTool = this.findSubagentTool();
            if (!subagentTool) {
                return this.failure(
                    'GitHub Copilot runSubagent is unavailable. Ensure GitHub Copilot is enabled and subagents are supported by this VS Code version.',
                    record
                );
            }

            const schemaProperties = (subagentTool.inputSchema as {
                properties?: Record<string, unknown>;
            }).properties;
            if (!schemaProperties?.agentName) {
                return this.failure(
                    `The registered ${subagentTool.name} tool does not support named custom agents through agentName.`,
                    record
                );
            }

            const result = await this.executeAgentViaTool(
                subagentTool,
                agentName,
                this.buildTaskPrompt(agentName, prompt, context, stateWrites),
                modelHint,
                timeout,
                executionContext,
                onLog,
                onProgress
            );

            if (record) {
                record.structuredOutput = result.output;
                record.filesModified = result.filesModified;
                record.logs?.push(`Copilot subagent completed in ${Date.now() - startTime}ms`);
                if (!result.success) {
                    record.errors?.push(result.output);
                }
            }

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.failure(errorMessage, record);
        }
    }

    private async executeAgentViaTool(
        subagentTool: vscode.LanguageModelToolInformation,
        agentName: string,
        taskPrompt: string,
        modelHint: string | undefined,
        timeout: number,
        executionContext: CopilotSubagentExecutionContext,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void
    ): Promise<AgentInvocationResult> {
        const tokenSource = new vscode.CancellationTokenSource();
        const cancel = () => tokenSource.cancel();
        const chatCancellation = executionContext.cancellationToken.onCancellationRequested(cancel);
        const workflowAbortSignal = executionContext.workflowAbortSignal;
        workflowAbortSignal?.addEventListener('abort', cancel, { once: true });

        const timeoutHandle = setTimeout(cancel, timeout * 1000);

        try {
            onLog?.(`[AgentInvoker] Invoking genuine Copilot subagent "${agentName}" via ${subagentTool.name}`);
            onProgress?.(`Starting Copilot subagent ${agentName}...`);

            const toolInput: Record<string, unknown> = {
                agentName,
                prompt: taskPrompt,
                description: `Workflow agent: ${agentName}`
            };
            if (modelHint) {
                toolInput.model = await this.resolveModelHint(modelHint);
            }

            const toolResult = await vscode.lm.invokeTool(
                subagentTool.name,
                {
                    toolInvocationToken: executionContext.toolInvocationToken as vscode.ChatParticipantToolToken | undefined,
                    input: toolInput
                },
                tokenSource.token
            );

            const outputParts: string[] = [];
            for (const part of toolResult.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    outputParts.push(part.value);
                } else if (part instanceof vscode.LanguageModelPromptTsxPart) {
                    outputParts.push(JSON.stringify(part.value));
                }
            }

            const output = outputParts.join('').trim();
            if (!output) {
                return {
                    success: false,
                    output: `Copilot subagent "${agentName}" returned no textual result.`,
                    filesModified: []
                };
            }

            onLog?.(`[AgentInvoker] Copilot subagent "${agentName}" completed (${output.length} characters)`);
            return {
                success: true,
                output,
                filesModified: []
            };
        } catch (error) {
            if (tokenSource.token.isCancellationRequested) {
                return {
                    success: false,
                    output: `Copilot subagent "${agentName}" was cancelled or timed out after ${timeout} seconds.`,
                    filesModified: []
                };
            }

            if (error instanceof vscode.LanguageModelError) {
                return {
                    success: false,
                    output: `Copilot subagent failed (${error.code}): ${error.message}`,
                    filesModified: []
                };
            }

            return {
                success: false,
                output: `Copilot subagent failed: ${error instanceof Error ? error.message : String(error)}`,
                filesModified: []
            };
        } finally {
            clearTimeout(timeoutHandle);
            chatCancellation.dispose();
            workflowAbortSignal?.removeEventListener('abort', cancel);
            tokenSource.dispose();
        }
    }

    /**
     * Locate VS Code's generic custom-agent tool. Specialized search and
     * execution subagents are intentionally not accepted.
     */
    private findSubagentTool(): vscode.LanguageModelToolInformation | undefined {
        const supportedNames = new Set([
            'runSubagent',
            'agent/runSubagent',
            'agent_runSubagent'
        ]);
        return vscode.lm.tools.find(tool => supportedNames.has(tool.name));
    }

    private async resolveModelHint(modelHint: string): Promise<string> {
        const normalizedHint = modelHint.toLowerCase();
        const models = await vscode.lm.selectChatModels();
        const model = models.find(candidate =>
            candidate.id.toLowerCase() === normalizedHint ||
            candidate.name.toLowerCase() === normalizedHint ||
            `${candidate.name} (${candidate.vendor})`.toLowerCase() === normalizedHint
        ) ?? models.find(candidate =>
            candidate.id.toLowerCase().includes(normalizedHint) ||
            candidate.name.toLowerCase().includes(normalizedHint)
        );

        return model ? `${model.name} (${model.vendor})` : modelHint;
    }

    private buildTaskPrompt(
        agentName: string,
        prompt: string,
        context: Record<string, unknown>,
        stateWrites?: Array<{ source: string; target: string }>
    ): string {
        let taskPrompt = prompt.trim() || `Execute the "${agentName}" workflow step.`;

        if (Object.keys(context).length > 0) {
            taskPrompt += '\n\n## Workflow State\n';
            for (const [key, value] of Object.entries(context)) {
                taskPrompt += `- ${key}: ${JSON.stringify(value)}\n`;
            }
        }

        // Auto-append output format instructions when stateWrites are configured
        if (stateWrites && stateWrites.length > 0) {
            const fields = stateWrites.map(m => m.source);
            taskPrompt += '\n\n## Output Format\n';
            taskPrompt += 'Return your response as a JSON object with the following fields:\n';
            for (const field of fields) {
                taskPrompt += `- ${field}\n`;
            }
            taskPrompt += '\nExample: {"field1": "value1", "field2": "value2"}';
        }

        return taskPrompt;
    }

    private failure(message: string, record?: NodeExecutionRecord): AgentInvocationResult {
        record?.errors?.push(message);
        record?.logs?.push(`Copilot subagent failed: ${message}`);
        return { success: false, output: message, filesModified: [] };
    }

    private parseFrontmatter(text: string): Record<string, string> {
        const result: Record<string, string> = {};
        for (const line of text.split(/\r?\n/)) {
            const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
            if (match) {
                result[match[1]] = match[2].trim();
            }
        }
        return result;
    }
}
