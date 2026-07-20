/**
 * Execution context and agent invoker interfaces — vscode-free.
 *
 * Used by WorkflowExecutor to pass cancellation and progress reporting
 * into the execution loop, and to invoke agents through a testable seam.
 * The actual VS Code types are adapted in WorkflowRuntime / AgentInvoker.
 */

export interface CopilotSubagentExecutionContext {
    /** VS Code ChatParticipantToolToken — required by runSubagent. Kept as unknown for testability. */
    toolInvocationToken: unknown;
    /** CancellationToken for the chat request. */
    cancellationToken: {
        isCancellationRequested: boolean;
        onCancellationRequested(listener: () => void): { dispose(): void };
    };
    workflowAbortSignal?: AbortSignal;
    reportProgress?: (message: string) => void;
}

export interface AgentInvocationResult {
    success: boolean;
    output: string;
    error?: string;
    filesModified?: string[];
}

export interface IAgentInvoker {
    invokeAgent(
        agentPath: string,
        prompt: string,
        context: Record<string, unknown>,
        timeout: number,
        modelHint: string | undefined,
        executionContext: CopilotSubagentExecutionContext,
        record?: any,
        onLog?: (message: string) => void,
        onProgress?: (message: string) => void
    ): Promise<AgentInvocationResult>;
}
