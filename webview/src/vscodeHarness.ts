/**
 * VSCodeHarness — production adapter for MessagingHarness.
 * Delegates to acquireVsCodeApi() for real VS Code webview communication.
 */

import { MessagingHarness, DesignerMessage, MessageHandler } from './messagingHarness';

declare function acquireVsCodeApi(): {
    postMessage(message: any): void;
    getState(): any;
    setState(value: any): void;
};

export class VSCodeHarness implements MessagingHarness {
    private api: ReturnType<typeof acquireVsCodeApi>;

    constructor(acquire: typeof acquireVsCodeApi) {
        try {
            this.api = acquire();
        } catch (e: any) {
            throw new Error(`Failed to acquire VS Code API: ${e.message}`);
        }
    }

    post(message: DesignerMessage): void {
        this.api.postMessage(message);
    }

    getState(): any {
        return this.api.getState();
    }

    setState(value: any): void {
        this.api.setState(value);
    }

    onMessage(handler: MessageHandler): void {
        window.addEventListener('message', (event) => {
            handler(event.data);
        });
    }

    asWebviewUri(path: string): string {
        return path;
    }
}
