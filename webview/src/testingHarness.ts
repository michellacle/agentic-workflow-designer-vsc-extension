/**
 * TestingHarness — in-memory adapter for MessagingHarness.
 *
 * Captures all outgoing messages and supports injecting incoming messages.
 * Used by Jest tests and the standalone HTML runner.
 */

import { MessagingHarness, DesignerMessage, MessageHandler } from './messagingHarness';

export class TestingHarness implements MessagingHarness {
    /** All messages posted by the designer, in order. */
    readonly postedMessages: DesignerMessage[] = [];

    /** Last value passed to setState. */
    persistedState: any = null;

    /** Registered message handler (set by designer via onMessage). */
    private _handler: MessageHandler | null = null;

    post(message: DesignerMessage): void {
        this.postedMessages.push(message);
    }

    getState(): any {
        return this.persistedState;
    }

    setState(value: any): void {
        this.persistedState = value;
    }

    onMessage(handler: MessageHandler): void {
        this._handler = handler;
    }

    asWebviewUri(path: string): string {
        return path;
    }

    /**
     * Simulate an incoming message from the host (e.g., an executionUpdate from the extension).
     * Delivers synchronously to the designer's registered handler.
     */
    send(message: any): void {
        if (this._handler) {
            this._handler(message);
        }
    }

    /**
     * Find the most recent message of a given type.
     */
    findLast(type: string): DesignerMessage | undefined {
        for (let i = this.postedMessages.length - 1; i >= 0; i--) {
            if (this.postedMessages[i].type === type) {
                return this.postedMessages[i];
            }
        }
        return undefined;
    }

    /**
     * Clear all captured messages.
     */
    clear(): void {
        this.postedMessages.length = 0;
    }
}
