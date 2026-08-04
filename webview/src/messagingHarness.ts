/**
 * MessagingHarness — the seam between the designer module and its host environment.
 *
 * The designer calls into this interface for all external communication.
 * Two adapters:
 *   - VSCodeHarness (production): delegates to acquireVsCodeApi()
 *   - TestingHarness (test / standalone): captures messages in memory
 *
 * This is the interface; the implementation details of each adapter are internal.
 */

/**
 * A message the designer sends to its host.
 */
export interface DesignerMessage {
    type: string;
    [key: string]: any;
}

/**
 * Callback for incoming messages from the host.
 */
export type MessageHandler = (message: any) => void;

/**
 * Small interface for the designer's external communication needs.
 * Three methods cover all 18 vscode.* call sites in the designer.
 */
export interface MessagingHarness {
    /** Send a message to the host environment. */
    post(message: DesignerMessage): void;

    /** Get persisted state from the host. */
    getState(): any;

    /** Persist state to the host. */
    setState(value: any): void;

    /** Register a handler for incoming messages from the host. Fires synchronously for each message. */
    onMessage(handler: MessageHandler): void;

    /** Resolve a VS Code webview URI (only meaningful for VSCodeHarness; returns path as-is for others). */
    asWebviewUri(path: string): string;
}
