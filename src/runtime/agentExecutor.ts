import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

/**
 * Tool definition for the agent tool-calling loop
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * Tool call requested by the model
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * Result of executing a tool
 */
export interface ToolResult {
    id: string;
    name: string;
    success: boolean;
    output: string;
}

/**
 * Available tools for agents
 */
const TOOLS: ToolDefinition[] = [
    {
        name: 'create_file',
        description: 'Create a new file with the given content. Creates parent directories if needed.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path relative to workspace root' },
                content: { type: 'string', description: 'File content' }
            },
            required: ['filePath', 'content']
        }
    },
    {
        name: 'read_file',
        description: 'Read the contents of a file.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path relative to workspace root' }
            },
            required: ['filePath']
        }
    },
    {
        name: 'edit_file',
        description: 'Edit an existing file by replacing text.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path relative to workspace root' },
                oldText: { type: 'string', description: 'Text to replace' },
                newText: { type: 'string', description: 'Replacement text' }
            },
            required: ['filePath', 'oldText', 'newText']
        }
    },
    {
        name: 'run_command',
        description: 'Run a shell command in the workspace root directory.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' }
            },
            required: ['command']
        }
    },
    {
        name: 'list_directory',
        description: 'List the contents of a directory.',
        parameters: {
            type: 'object',
            properties: {
                directoryPath: { type: 'string', description: 'Path relative to workspace root' }
            },
            required: ['directoryPath']
        }
    },
    {
        name: 'delete_file',
        description: 'Delete a file.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Path relative to workspace root' }
            },
            required: ['filePath']
        }
    }
];

/**
 * Prompt template for tool calling
 */
const TOOL_CALLING_SYSTEM_PROMPT = `You are an agent with access to tools. You can perform actions by requesting tool calls.

## Available Tools

${TOOLS.map(t => `- **${t.name}**: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters.properties)}`).join('\n\n')}

## How to Use Tools

When you need to perform an action, respond with a tool call in this JSON format:
\`\`\`tool_call
{
  "tool": "tool_name",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

When you're done and want to provide your final answer, respond normally without a tool call.

## Rules
- Use one tool call at a time
- Wait for the result before making the next tool call
- File paths are relative to the workspace root
- Always check if a file exists before editing it
- Report what you've done in your final response`;

/**
 * Agent executor with tool calling capability
 */
export class AgentExecutor {
    private _filesModified: string[] = [];
    private _logs: string[] = [];

    constructor(
        private readonly workspaceRoot: string,
        private readonly onLog?: (message: string) => void,
        private readonly onProgress?: (message: string) => void
    ) {}

    /**
     * Execute an agent with tool calling
     */
    async execute(
        agentInstructions: string,
        task: string,
        context: Record<string, unknown>,
        model: vscode.LanguageModelChat,
        timeout: number = 120,
        maxIterations: number = 15
    ): Promise<{ success: boolean; output: string; filesModified: string[] }> {
        this._filesModified = [];
        this._logs = [];

        const tokenSource = new vscode.CancellationTokenSource();
        const timeoutHandle = setTimeout(() => tokenSource.cancel(), timeout * 1000);

        try {
            // Build system prompt with agent instructions + tool definitions
            const systemPrompt = `${agentInstructions}

${TOOL_CALLING_SYSTEM_PROMPT}`;

            // Build user message with task + context
            let userMessage = task;
            if (Object.keys(context).length > 0) {
                userMessage += `\n\n## Context\n${Object.entries(context).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}`;
            }

            // Tool-calling loop
            let conversationHistory: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.User(systemPrompt + `\n\n## Task\n${userMessage}`)
            ];

            let finalOutput = '';

            for (let iteration = 0; iteration < maxIterations; iteration++) {
                // Check abort before each iteration
                if (tokenSource.token.isCancellationRequested) {
                    throw new Error('Agent execution cancelled');
                }

                this.log(`[AgentExecutor] Iteration ${iteration + 1}/${maxIterations}`);
                this.progress(`Thinking...`);

                // Send request to model with a per-request timeout
                this.log(`[AgentExecutor] Calling ${model.id} (vendor: ${model.vendor})...`);
                const requestStartTime = Date.now();

                // Wrap sendRequest in a Promise.race to enforce a per-request timeout
                // The overall cancellation token may not be respected by all model providers
                const requestPromise = model.sendRequest(
                    conversationHistory,
                    {},
                    tokenSource.token
                );
                const requestTimeout = Math.min(timeout * 1000, 120_000); // Max 120s per request
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Model request timed out after ${requestTimeout / 1000}s (no response from ${model.id})`));
                    }, requestTimeout);
                });

                let response: vscode.LanguageModelChatResponse;
                try {
                    response = await Promise.race([requestPromise, timeoutPromise]);
                } catch (err) {
                    const elapsed = ((Date.now() - requestStartTime) / 1000).toFixed(1);
                    this.log(`[AgentExecutor] Request failed after ${elapsed}s: ${err}`);
                    throw err;
                }

                const requestElapsed = ((Date.now() - requestStartTime) / 1000).toFixed(1);
                this.log(`[AgentExecutor] Response received after ${requestElapsed}s, starting to stream...`);

                // Collect response with streaming progress
                let responseText = '';
                let lastProgressUpdate = Date.now();
                let fragmentCount = 0;
                const streamStartTime = Date.now();

                for await (const fragment of response.text) {
                    // Check abort during streaming
                    if (tokenSource.token.isCancellationRequested) {
                        throw new Error('Agent execution cancelled');
                    }

                    responseText += fragment;
                    fragmentCount++;

                    // Update progress every 500ms with a snippet of the response
                    const now = Date.now();
                    if (now - lastProgressUpdate > 500) {
                        const preview = responseText.trim().split('\n').filter(l => l.trim())[0]?.substring(0, 80) || responseText.substring(0, 80);
                        this.progress(`${preview}${preview.length >= 80 ? '…' : ''}`);
                        lastProgressUpdate = now;
                    }
                }

                const streamElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
                this.log(`[AgentExecutor] Stream complete: ${fragmentCount} fragments in ${streamElapsed}s (${responseText.length} chars)`);

                this.log(`[AgentExecutor] Model response (${responseText.length} chars)`);

                // Check if model wants to call a tool
                const toolCall = this.parseToolCall(responseText);

                if (toolCall) {
                    this.log(`[AgentExecutor] Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

                    // Show tool execution progress
                    const toolDesc = this.getToolDescription(toolCall);
                    this.progress(`${toolDesc}...`);

                    // Execute the tool
                    const result = await this.executeTool(toolCall);
                    this.log(`[AgentExecutor] Tool result: ${result.success ? 'OK' : 'FAILED'} - ${result.output.substring(0, 200)}`);

                    // Add tool result to conversation
                    conversationHistory.push(
                        vscode.LanguageModelChatMessage.Assistant(responseText),
                        vscode.LanguageModelChatMessage.User(`Tool result for ${toolCall.name}: ${result.output}`)
                    );

                    // Track file modifications
                    if (result.success && (result.output.startsWith('[FILE_CREATED]') || result.output.startsWith('[FILE_EDITED]'))) {
                        const filePath = result.output.match(/\[FILE_(CREATED|EDITED)]: ([^\s]+)/)?.[2];
                        if (filePath && !this._filesModified.includes(filePath)) {
                            this._filesModified.push(filePath);
                        }
                    }
                } else {
                    // Final response - no more tool calls
                    finalOutput = responseText.trim();
                    break;
                }
            }

            if (!finalOutput) {
                finalOutput = `Agent completed ${this._logs.length} operations but didn't provide a final summary.\nFiles modified: ${this._filesModified.join(', ') || 'none'}`;
            }

            clearTimeout(timeoutHandle);
            return {
                success: true,
                output: finalOutput,
                filesModified: [...this._filesModified]
            };
        } catch (error) {
            clearTimeout(timeoutHandle);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`[AgentExecutor] Error: ${errorMsg}`);
            return {
                success: false,
                output: `Agent execution failed: ${errorMsg}`,
                filesModified: [...this._filesModified]
            };
        } finally {
            tokenSource.dispose();
        }
    }

    private progress(message: string): void {
        if (this.onProgress) {
            this.onProgress(message);
        }
    }

    private getToolDescription(call: { name: string; arguments: Record<string, unknown> }): string {
        switch (call.name) {
            case 'create_file':
                return `Creating ${String(call.arguments.filePath || 'file')}`;
            case 'read_file':
                return `Reading ${String(call.arguments.filePath || 'file')}`;
            case 'edit_file':
                return `Editing ${String(call.arguments.filePath || 'file')}`;
            case 'run_command':
                return `Running ${String(call.arguments.command || 'command')}`;
            case 'list_directory':
                return `Listing ${String(call.arguments.directoryPath || 'directory')}`;
            case 'delete_file':
                return `Deleting ${String(call.arguments.filePath || 'file')}`;
            default:
                return `Running ${call.name}`;
        }
    }

    /**
     * Parse a tool call from model response
     */
    private parseToolCall(response: string): ToolCall | null {
        // Match ```tool_call ... ``` blocks
        const match = response.match(/```tool_call\s*\n([\s\S]*?)```/);
        if (!match) return null;

        try {
            const parsed = JSON.parse(match[1]);
            return {
                id: `call_${Date.now()}`,
                name: parsed.tool,
                arguments: parsed.parameters || {}
            };
        } catch {
            return null;
        }
    }

    /**
     * Execute a tool call
     */
    private async executeTool(call: ToolCall): Promise<ToolResult> {
        const { name, arguments: args } = call;

        try {
            switch (name) {
                case 'create_file':
                    return await this.toolCreateFile(args);
                case 'read_file':
                    return await this.toolReadFile(args);
                case 'edit_file':
                    return await this.toolEditFile(args);
                case 'run_command':
                    return await this.toolRunCommand(args);
                case 'list_directory':
                    return await this.toolListDirectory(args);
                case 'delete_file':
                    return await this.toolDeleteFile(args);
                default:
                    return {
                        id: call.id,
                        name,
                        success: false,
                        output: `Unknown tool: ${name}`
                    };
            }
        } catch (error) {
            return {
                id: call.id,
                name,
                success: false,
                output: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private async toolCreateFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = String(args.filePath || '');
        const content = String(args.content || '');
        const fullPath = path.join(this.workspaceRoot, filePath);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        this._filesModified.push(filePath);

        return {
            id: '',
            name: 'create_file',
            success: true,
            output: `[FILE_CREATED]: ${filePath} (${content.length} bytes)`
        };
    }

    private async toolReadFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = String(args.filePath || '');
        const fullPath = path.join(this.workspaceRoot, filePath);

        if (!fs.existsSync(fullPath)) {
            return {
                id: '',
                name: 'read_file',
                success: false,
                output: `File not found: ${filePath}`
            };
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        return {
            id: '',
            name: 'read_file',
            success: true,
            output: content
        };
    }

    private async toolEditFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = String(args.filePath || '');
        const oldText = String(args.oldText || '');
        const newText = String(args.newText || '');
        const fullPath = path.join(this.workspaceRoot, filePath);

        if (!fs.existsSync(fullPath)) {
            return {
                id: '',
                name: 'edit_file',
                success: false,
                output: `File not found: ${filePath}`
            };
        }

        let content = fs.readFileSync(fullPath, 'utf-8');
        if (!content.includes(oldText)) {
            return {
                id: '',
                name: 'edit_file',
                success: false,
                output: `Text not found in file: ${filePath}\nLooking for: ${oldText.substring(0, 100)}...`
            };
        }

        content = content.replace(oldText, newText);
        fs.writeFileSync(fullPath, content, 'utf-8');
        this._filesModified.push(filePath);

        return {
            id: '',
            name: 'edit_file',
            success: true,
            output: `[FILE_EDITED]: ${filePath}`
        };
    }

    private async toolRunCommand(args: Record<string, unknown>): Promise<ToolResult> {
        const command = String(args.command || '');
        const timeout = Number(args.timeout || 30000);

        return new Promise((resolve) => {
            const child = child_process.spawn(command, {
                cwd: this.workspaceRoot,
                shell: true,
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                resolve({
                    id: '',
                    name: 'run_command',
                    success: false,
                    output: `Command timed out after ${timeout}ms\n${stdout}\n${stderr}`
                });
            }, timeout);

            child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            child.on('close', (code) => {
                clearTimeout(timer);
                const output = stdout.trim() || stderr.trim() || '(no output)';
                resolve({
                    id: '',
                    name: 'run_command',
                    success: code === 0,
                    output: `[EXIT ${code}] ${output}`
                });
            });
        });
    }

    private async toolListDirectory(args: Record<string, unknown>): Promise<ToolResult> {
        const dirPath = String(args.directoryPath || '.');
        const fullPath = path.join(this.workspaceRoot, dirPath);

        if (!fs.existsSync(fullPath)) {
            return {
                id: '',
                name: 'list_directory',
                success: false,
                output: `Directory not found: ${dirPath}`
            };
        }

        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const output = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');

        return {
            id: '',
            name: 'list_directory',
            success: true,
            output
        };
    }

    private async toolDeleteFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = String(args.filePath || '');
        const fullPath = path.join(this.workspaceRoot, filePath);

        if (!fs.existsSync(fullPath)) {
            return {
                id: '',
                name: 'delete_file',
                success: false,
                output: `File not found: ${filePath}`
            };
        }

        fs.unlinkSync(fullPath);
        return {
            id: '',
            name: 'delete_file',
            success: true,
            output: `[FILE_DELETED]: ${filePath}`
        };
    }

    private log(message: string): void {
        this._logs.push(message);
        if (this.onLog) {
            this.onLog(message);
        }
    }
}
