import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    AgentNodeData, NodeExecutionRecord, NodeStatus
} from '../models/workflow';
import { AgentExecutor } from './agentExecutor';

/**
 * Invokes VS Code custom agents using the platform's agent_runSubagent tool
 */
export class AgentInvoker {
    private nativeSubagentToolRequiresChatContext = false;

    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * Discover agents in the .github/agents/ directory
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
            // Directory doesn't exist yet
        }

        return agents;
    }

    /**
     * Parse an agent.md file to extract configuration
     */
    async parseAgentFile(agentPath: string): Promise<{ name: string; description?: string; instructions: string }> {
        const content = fs.readFileSync(agentPath, 'utf-8');

        // Extract frontmatter if present
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        const frontmatter = frontmatterMatch ? this.parseFrontmatter(frontmatterMatch[1]) : {};

        // Extract instructions (content after frontmatter)
        const instructions = frontmatterMatch
            ? content.substring(frontmatterMatch[0].length).trim()
            : content.trim();

        return {
            name: frontmatter.name || path.basename(agentPath, '.agent.md'),
            description: frontmatter.description,
            instructions
        };
    }

    /**
     * Invoke an agent with the given prompt and context using vscode.lm.invokeTool
     */
    async invokeAgent(
        agentPath: string,
        prompt: string,
        context: Record<string, unknown>,
        timeout: number = 120,
        modelHint?: string,
        record?: NodeExecutionRecord,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        const startTime = Date.now();

        try {
            // Read agent configuration
            const agentConfig = await this.parseAgentFile(agentPath);
            const agentName = agentConfig.name;

            if (record) {
                record.prompt = prompt;
                record.contextIn = context;
                record.logs?.push(`Invoking agent: ${agentName}`);
            }

            // Prefer VS Code's native custom-agent tool when the active chat provider
            // exposes it. Providers that only implement the Language Model API do not
            // register this tool, so use the local agent loop in that case.
            const subagentTool = this.nativeSubagentToolRequiresChatContext
                ? undefined
                : this.findSubagentTool();
            let result = subagentTool
                ? await this.executeAgentViaTool(
                    subagentTool,
                    agentName,
                    this.buildPrompt(agentConfig.instructions, prompt, context),
                    modelHint,
                    timeout,
                    onLog,
                    onProgress
                )
                : await this.executeAgentDirect(
                    agentPath,
                    agentConfig.instructions,
                    prompt,
                    context,
                    modelHint,
                    timeout,
                    onLog,
                    onProgress
                );

            if (subagentTool && !result.success && this.requiresToolInvocationToken(result.output)) {
                this.nativeSubagentToolRequiresChatContext = true;
                onLog?.(`[AgentInvoker] ${subagentTool.name} requires a chat invocation token; using the direct executor`);
                result = await this.executeAgentDirect(
                    agentPath,
                    agentConfig.instructions,
                    prompt,
                    context,
                    modelHint,
                    timeout,
                    onLog,
                    onProgress
                );
            }

            if (record) {
                record.structuredOutput = result.output;
                record.filesModified = result.filesModified;
                record.logs?.push(`Agent completed in ${Date.now() - startTime}ms`);
            }

            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (record) {
                record.errors?.push(errorMsg);
                record.logs?.push(`Agent failed: ${errorMsg}`);
            }
            return { success: false, output: errorMsg };
        }
    }

    /**
     * Execute the agent using the native custom-agent tool.
     * This delegates to VS Code's built-in agent orchestration system, which handles
     * tool access, file operations, and model selection automatically.
     */
    private async executeAgentViaTool(
        subagentTool: vscode.LanguageModelToolInformation,
        agentName: string,
        fullPrompt: string,
        modelHint?: string,
        timeout: number = 120,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        const tokenSource = new vscode.CancellationTokenSource();
        const timeoutHandle = setTimeout(() => {
            tokenSource.cancel();
        }, timeout * 1000);

        try {
            console.log(`[AgentInvoker] Found ${subagentTool.name} tool, invoking agent: ${agentName}`);
            if (modelHint) {
                console.log(`[AgentInvoker] Model hint: "${modelHint}"`);
            }

            onLog?.(`[AgentInvoker] Invoking ${subagentTool.name} for "${agentName}"`);
            onProgress?.(`Starting agent ${agentName}...`);

            // Build tool input matching the agent_runSubagent schema
            const toolInput: Record<string, unknown> = {
                agent: agentName,
                prompt: fullPrompt,
            };

            // Add model hint if provided
            if (modelHint) {
                toolInput.model = modelHint;
            }

            // Add description for better UX
            toolInput.description = `Workflow agent: ${agentName}`;

            console.log(`[AgentInvoker] Tool input: ${JSON.stringify(toolInput, null, 2)}`);

            // Invoke the tool via VS Code's LM API
            const toolResult = await vscode.lm.invokeTool(
                subagentTool.name,
                {
                    toolInvocationToken: undefined, // Not in chat context
                    input: toolInput
                },
                tokenSource.token
            );

            // Extract text content from the tool result
            let output = '';
            for (const part of toolResult.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    output += part.value;
                }
            }

            console.log(`[AgentInvoker] Agent completed, output length: ${output.length}`);
            clearTimeout(timeoutHandle);
            return {
                success: true,
                output: output.trim(),
                filesModified: [] // The agent handles file operations internally
            };
        } catch (error) {
            clearTimeout(timeoutHandle);

            // Handle cancellation
            if (error instanceof Error && error.message.includes('cancel')) {
                console.log('[AgentInvoker] Agent execution cancelled');
                return {
                    success: false,
                    output: 'Agent execution cancelled',
                    filesModified: []
                };
            }

            // Handle language model errors
            if (error instanceof vscode.LanguageModelError) {
                console.error('[AgentInvoker] LanguageModelError:', {
                    code: error.code,
                    message: error.message
                });
                return {
                    success: false,
                    output: `Language model error (${error.code}): ${error.message}`,
                    filesModified: []
                };
            }

            console.error('[AgentInvoker] Unexpected error:', error);
            return {
                success: false,
                output: error instanceof Error ? error.message : String(error),
                filesModified: []
            };
        } finally {
            tokenSource.dispose();
        }
    }

    /**
     * Locate the generic custom-agent tool. execution_subagent, search_subagent,
     * and explore_subagent are specialized helpers and cannot run an .agent.md file.
     */
    private findSubagentTool(): vscode.LanguageModelToolInformation | undefined {
        const supportedNames = new Set([
            'agent_runSubagent',
            'agent/runSubagent',
            'runSubagent'
        ]);
        return vscode.lm.tools.find(tool => supportedNames.has(tool.name));
    }

    private requiresToolInvocationToken(output: string): boolean {
        const normalizedOutput = output.toLowerCase();
        return normalizedOutput.includes('toolinvocationtoken') ||
            normalizedOutput.includes('tool invocation token');
    }

    /**
     * Run the agent through the public Language Model API when the active provider
     * does not expose VS Code's generic custom-agent tool.
     */
    private async executeAgentDirect(
        agentPath: string,
        instructions: string,
        prompt: string,
        context: Record<string, unknown>,
        modelHint: string | undefined,
        timeout: number,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(agentPath))
            ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { success: false, output: 'No workspace folder found.', filesModified: [] };
        }

        const models = await vscode.lm.selectChatModels();
        const model = this.selectModel(models, modelHint);
        if (!model) {
            const available = models.map(candidate => `  - ${candidate.id} (${candidate.vendor})`).join('\n');
            const reason = modelHint
                ? `Model "${modelHint}" not found.`
                : 'No model specified for this agent node.';
            return {
                success: false,
                output: `${reason}\nAvailable models:\n${available || '  - none'}`,
                filesModified: []
            };
        }

        onLog?.(`[AgentInvoker] Using direct model ${model.id} (${model.vendor})`);
        const executor = new AgentExecutor(workspaceFolder.uri.fsPath, onLog, onProgress);
        return executor.execute(instructions, prompt, context, model, timeout);
    }

    private selectModel(
        models: readonly vscode.LanguageModelChat[],
        modelHint?: string
    ): vscode.LanguageModelChat | undefined {
        if (!modelHint) {
            return undefined;
        }

        const normalizedHint = modelHint.toLowerCase();
        const slashIndex = normalizedHint.indexOf('/');
        if (slashIndex >= 0) {
            const vendor = normalizedHint.substring(0, slashIndex);
            const modelName = normalizedHint.substring(slashIndex + 1);
            return models.find(model =>
                model.vendor.toLowerCase() === vendor &&
                model.id.toLowerCase().includes(modelName)
            ) ?? models.find(model => model.id.toLowerCase().includes(modelName));
        }

        return models.find(model => model.id.toLowerCase() === normalizedHint)
            ?? models.find(model => model.id.toLowerCase().includes(normalizedHint))
            ?? models.find(model => model.vendor.toLowerCase().includes(normalizedHint));
    }

    /**
     * Build the full prompt combining agent instructions, user prompt, and context
     */
    private buildPrompt(instructions: string, prompt: string, context: Record<string, unknown>): string {
        let fullPrompt = instructions;

        if (Object.keys(context).length > 0) {
            fullPrompt += '\n\n## Context\n';
            for (const [key, value] of Object.entries(context)) {
                fullPrompt += `- ${key}: ${JSON.stringify(value)}\n`;
            }
        }

        if (prompt) {
            fullPrompt += `\n## Task\n${prompt}`;
        }

        return fullPrompt;
    }

    private parseFrontmatter(text: string): Record<string, string> {
        const result: Record<string, string> = {};
        for (const line of text.split('\n')) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                result[match[1]] = match[2].trim();
            }
        }
        return result;
    }
}
