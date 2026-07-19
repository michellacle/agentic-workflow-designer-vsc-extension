// VS Code Webview API declarations
declare function acquireVsCodeApi(): {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
};

// Extend Window for global functions
interface Window {
    deleteSelectedNodes?: () => void;
}
