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
            // For Phase 2, we use a terminal-based approach
            const result = await this.executeAgent(agentPath, fullPrompt, timeout);

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
     * Execute the agent via terminal (Phase 2 approach)
     */
    private async executeAgent(
        agentPath: string,
        prompt: string,
        timeout: number
    ): Promise<{ success: boolean; output: string; filesModified?: string[] }> {
        return new Promise((resolve) => {
            const timeoutHandle = setTimeout(() => {
                resolve({
                    success: false,
                    output: `Agent execution timed out after ${timeout} seconds`
                });
            }, timeout * 1000);

            // In a real implementation, this would invoke the VS Code agent
            // For now, we simulate the execution
            clearTimeout(timeoutHandle);

            // Read the agent file content as the "output" for prototype
            try {
                const content = fs.readFileSync(agentPath, 'utf-8');
                resolve({
                    success: true,
                    output: `Agent executed successfully. Agent definition:\n${content.substring(0, 500)}`,
                    filesModified: []
                });
            } catch {
                resolve({
                    success: false,
                    output: `Could not read agent file: ${agentPath}`
                });
            }
        });
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
