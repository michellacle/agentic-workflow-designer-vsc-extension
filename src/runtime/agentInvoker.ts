import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    AgentNodeData, NodeExecutionRecord, NodeStatus
} from '../models/workflow';

/**
 * Invokes VS Code custom agents
 */
export class AgentInvoker {

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
     * Invoke an agent with the given prompt and context
     */
    async invokeAgent(
        agentPath: string,
        prompt: string,
        context: Record<string, unknown>,
        timeout: number = 120,
        modelHint?: string,
        record?: NodeExecutionRecord
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        const startTime = Date.now();

        try {
            // Read agent configuration
            const agentConfig = await this.parseAgentFile(agentPath);

            if (record) {
                record.prompt = prompt;
                record.contextIn = context;
                record.logs?.push(`Invoking agent: ${agentConfig.name}`);
            }

            // Build the full prompt with agent instructions + user prompt + context
            const fullPrompt = this.buildPrompt(agentConfig.instructions, prompt, context);

            // Invoke the agent using VS Code's chat/terminal interface
            const result = await this.executeAgent(agentPath, fullPrompt, timeout, modelHint);

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
     * Execute the agent by sending its instructions + prompt to VS Code's Language Model API
     */
    private async executeAgent(
        _agentPath: string,
        fullPrompt: string,
        timeout: number,
        modelHint?: string
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        const tokenSource = new vscode.CancellationTokenSource();
        const timeoutHandle = setTimeout(() => {
            tokenSource.cancel();
        }, timeout * 1000);

        try {
            let languageModelChat: vscode.LanguageModelChat | null = null;

            // Always fetch all available models first
            const allModels = await vscode.lm.selectChatModels();
            console.log(`[AgentInvoker] Available models: ${allModels.map(m => `${m.id} (${m.vendor})`).join(', ') || 'none'}`);

            if (modelHint) {
                console.log(`[AgentInvoker] Model hint: "${modelHint}"`);
                const slashIdx = modelHint.indexOf('/');
                if (slashIdx >= 0) {
                    // Format: "vendor/model"
                    const vendor = modelHint.substring(0, slashIdx);
                    const modelPart = modelHint.substring(slashIdx + 1);
                    console.log(`[AgentInvoker] Searching vendor="${vendor}" for model containing "${modelPart}"`);
                    const vendorModels = allModels.filter(m => m.vendor.toLowerCase() === vendor.toLowerCase());
                    const match = vendorModels.find(m => m.id.toLowerCase().includes(modelPart.toLowerCase()));
                    if (match) {
                        languageModelChat = match;
                    } else {
                        // Fallback: search all models for the model part
                        const globalMatch = allModels.find(m => m.id.toLowerCase().includes(modelPart.toLowerCase()));
                        if (globalMatch) {
                            languageModelChat = globalMatch;
                        }
                    }
                } else {
                    // Model name — search all models by substring match
                    console.log(`[AgentInvoker] Searching all models for "${modelHint}"`);
                    const match = allModels.find(m => m.id.toLowerCase().includes(modelHint.toLowerCase()));
                    if (match) {
                        languageModelChat = match;
                    } else {
                        // Try matching against vendor as last resort
                        const vendorMatch = allModels.find(m => m.vendor.toLowerCase().includes(modelHint.toLowerCase()));
                        if (vendorMatch) {
                            languageModelChat = vendorMatch;
                        }
                    }
                }
            } else {
                // No model specified — require it
                clearTimeout(timeoutHandle);
                return {
                    success: false,
                    output: 'No model specified. Add a "model" field to the agent node (e.g. model: qwen3.6-27b, model: anthropic/claude-sonnet-4-20250514).',
                    filesModified: []
                };
            }

            if (!languageModelChat) {
                clearTimeout(timeoutHandle);
                const available = allModels.map(m => `  - ${m.id} (${m.vendor})`).join('\n');
                return {
                    success: false,
                    output: `Model "${modelHint}" not found.\nAvailable models:\n${available}`,
                    filesModified: []
                };
            }

            console.log(`[AgentInvoker] Selected model: ${languageModelChat.id} (vendor: ${languageModelChat.vendor})`);

            // Send the prompt to the model
            console.log(`[AgentInvoker] Sending request to LLM (${fullPrompt.length} chars)...`);
            const response = await languageModelChat.sendRequest(
                [vscode.LanguageModelChatMessage.User(fullPrompt)],
                {},
                tokenSource.token
            );
            console.log('[AgentInvoker] Response received, collecting fragments...');

            // Collect the streamed response
            let output = '';
            for await (const fragment of response.text) {
                output += fragment;
            }

            console.log(`[AgentInvoker] LLM response collected (${output.length} chars)`);
            clearTimeout(timeoutHandle);
            return {
                success: true,
                output: output.trim(),
                filesModified: []
            };
        } catch (error) {
            clearTimeout(timeoutHandle);
            // Log full error details for debugging
            if (error instanceof vscode.LanguageModelError) {
                console.error('[AgentInvoker] LanguageModelError:', {
                    code: error.code,
                    message: error.message,
                    cause: error.cause,
                    name: error.name,
                    stack: error.stack
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
