/**
 * Tests verifying the removal of the redundant execution log component.
 *
 * The execution log panel inside the webview designer was removed because
 * the workflow runtime already outputs logs to the VS Code Output Channel.
 * These tests confirm:
 * 1. No execution-panel HTML in webview template
 * 2. No onDidLogMessage event emitter in runtime
 * 3. No log-related webview DOM manipulation code
 * 4. No execution-panel CSS styles
 * 5. No execution-panel HTML in test.html
 * 6. logMessage handler is a no-op in the webview
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

// ===== Task 1: Remove execution log HTML from webview template =====

describe('Task 1: Execution log HTML removed from webview template', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('src/designer/workflowDesignerProvider.ts');
    });

    it('should not contain execution-panel div in getHtmlForWebview', () => {
        expect(content).not.toContain('execution-panel');
    });

    it('should not contain execution-log element reference', () => {
        expect(content).not.toContain('execution-log');
    });

    it('should not contain panel-header class reference', () => {
        expect(content).not.toContain('panel-header');
    });

    it('should not contain btn-clear-log reference', () => {
        expect(content).not.toContain('btn-clear-log');
    });

    it('should still contain the toolbar HTML with execution-status badge', () => {
        expect(content).toContain('execution-status');
        expect(content).toContain('status-badge');
    });

    it('should still contain the main canvas and panels', () => {
        expect(content).toContain('canvas-container');
        expect(content).toContain('properties-panel');
        expect(content).toContain('toolbox');
    });
});

// ===== Task 2: Remove onDidLogMessage subscription =====

describe('Task 2: onDidLogMessage subscription removed from designer provider', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('src/designer/workflowDesignerProvider.ts');
    });

    it('should not subscribe to onDidLogMessage', () => {
        expect(content).not.toContain('onDidLogMessage');
    });

    it('should still subscribe to onDidChangeExecutionState', () => {
        expect(content).toContain('onDidChangeExecutionState');
    });

    it('should still forward executionUpdate to webviews', () => {
        expect(content).toContain("'executionUpdate'");
    });
});

// ===== Task 3: Remove onDidLogMessage event emitter from runtime =====

describe('Task 3: onDidLogMessage event emitter removed from runtime', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('src/runtime/workflowRuntime.ts');
    });

    it('should not contain _onDidLogMessage private field', () => {
        expect(content).not.toContain('_onDidLogMessage');
    });

    it('should not contain onDidLogMessage public getter', () => {
        expect(content).not.toContain('onDidLogMessage');
    });

    it('should still contain _onDidChangeExecutionState', () => {
        expect(content).toContain('_onDidChangeExecutionState');
    });

    it('should still contain the log() method that writes to output channel', () => {
        expect(content).toContain('private log(message: string)');
        expect(content).toContain('_outputChannel.appendLine(message)');
    });

    it('log() method should not fire any event', () => {
        // Extract the log method body
        const logMatch = content.match(/private log\(message: string\): void \{([^}]+)\}/);
        expect(logMatch).not.toBeNull();
        const logBody = logMatch![1];
        expect(logBody).not.toContain('.fire(');
    });
});

// ===== Task 4: Remove log-related webview code =====

describe('Task 4: Log-related webview code removed from designer.ts', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('webview/src/designer.ts');
    });

    it('should not contain addLogMessage function', () => {
        expect(content).not.toMatch(/function\s+addLogMessage/);
    });

    it('should have logMessage case as a no-op', () => {
        // The logMessage case should exist but only contain a no-op comment
        const logMessageMatch = content.match(/case\s+'logMessage':\s*([^}]+?)(?:break|case|$)/s);
        expect(logMessageMatch).not.toBeNull();
        const logMessageBody = logMessageMatch![1];
        // Should only contain a comment, no actual log logic
        expect(logMessageBody).not.toContain('addLogMessage');
        expect(logMessageBody).not.toContain('execution-log');
        expect(logMessageBody).not.toContain('execution-panel');
    });

    it('should not reference execution-panel DOM element', () => {
        expect(content).not.toContain('execution-panel');
    });

    it('should not reference execution-log DOM element', () => {
        expect(content).not.toContain('execution-log');
    });

    it('should not contain clear-log button listener', () => {
        expect(content).not.toContain('btn-clear-log');
    });

    it('should not contain panel-header button click handler for log toggle', () => {
        expect(content).not.toMatch(/panel-header.*click/);
    });

    it('should still contain execution status badge update logic', () => {
        expect(content).toContain('execution-status');
        expect(content).toContain('updateExecutionStatusUI');
    });

    it('should still handle executionUpdate messages', () => {
        expect(content).toContain("case 'executionUpdate':");
    });
});

// ===== Task 5: Remove execution panel CSS =====

describe('Task 5: Execution panel CSS removed from designer.css', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('webview/src/designer.css');
    });

    it('should not contain #execution-panel styles', () => {
        expect(content).not.toContain('#execution-panel');
    });

    it('should not contain .panel-header styles', () => {
        expect(content).not.toContain('.panel-header');
    });

    it('should not contain #btn-clear-log styles', () => {
        expect(content).not.toContain('#btn-clear-log');
    });

    it('should not contain #execution-log styles', () => {
        expect(content).not.toContain('#execution-log');
    });

    it('should not contain .log-line styles', () => {
        expect(content).not.toContain('.log-line');
    });

    it('should still contain status-badge styles', () => {
        expect(content).toContain('.status-badge');
    });

    it('should still contain toolbar styles', () => {
        expect(content).toContain('#toolbar');
    });

    it('should still contain canvas styles', () => {
        expect(content).toContain('#canvas-container');
        expect(content).toContain('#canvas');
    });

    it('should still contain properties panel styles', () => {
        expect(content).toContain('#properties-panel');
    });

    it('should still contain toolbox styles', () => {
        expect(content).toContain('#toolbox');
    });
});

// ===== Task 6: Remove execution log from test HTML =====

describe('Task 6: Execution log HTML removed from test.html', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('webview/test.html');
    });

    it('should not contain execution-panel div', () => {
        expect(content).not.toContain('execution-panel');
    });

    it('should not contain execution-log element', () => {
        expect(content).not.toContain('execution-log');
    });

    it('should not contain btn-clear-log button', () => {
        expect(content).not.toContain('btn-clear-log');
    });

    it('should still contain the toolbar with execution-status badge', () => {
        expect(content).toContain('execution-status');
        expect(content).toContain('status-badge');
    });

    it('should still contain the main canvas and panels', () => {
        expect(content).toContain('canvas-container');
        expect(content).toContain('properties-panel');
        expect(content).toContain('toolbox');
    });
});

// ===== Integration: Verify no stray references remain =====

describe('Integration: No stray execution log references in source files', () => {
    const sourceFiles = [
        'src/runtime/workflowRuntime.ts',
        'src/designer/workflowDesignerProvider.ts',
        'webview/src/designer.ts',
        'webview/src/designer.css',
        'webview/test.html',
    ];

    it('should not contain "execution-panel" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('execution-panel');
        }
    });

    it('should not contain "execution-log" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('execution-log');
        }
    });

    it('should not contain "onDidLogMessage" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('onDidLogMessage');
        }
    });

    it('should not contain "_onDidLogMessage" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('_onDidLogMessage');
        }
    });

    it('should not contain "addLogMessage" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('addLogMessage');
        }
    });

    it('should not contain "btn-clear-log" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('btn-clear-log');
        }
    });

    it('should not contain "panel-header" in any source file', () => {
        for (const file of sourceFiles) {
            const content = readFile(file);
            expect(content).not.toContain('panel-header');
        }
    });
});

// ===== Verify preserved functionality =====

describe('Preserved functionality: Execution status badge remains', () => {
    it('workflowDesignerProvider.ts should still have execution-status in toolbar', () => {
        const content = readFile('src/designer/workflowDesignerProvider.ts');
        expect(content).toContain('execution-status');
        expect(content).toContain('status-badge');
    });

    it('designer.ts should still have updateExecutionStatusUI function', () => {
        const content = readFile('webview/src/designer.ts');
        expect(content).toMatch(/function\s+updateExecutionStatusUI/);
    });

    it('designer.css should still have status-badge styles', () => {
        const content = readFile('webview/src/designer.css');
        expect(content).toContain('.status-badge');
        expect(content).toContain('.status-badge.running');
        expect(content).toContain('.status-badge.completed');
        expect(content).toContain('.status-badge.failed');
        expect(content).toContain('.status-badge.paused');
    });

    it('test.html should still have execution-status badge', () => {
        const content = readFile('webview/test.html');
        expect(content).toContain('execution-status');
        expect(content).toContain('status-badge');
    });
});

describe('Preserved functionality: Runtime log() writes to output channel only', () => {
    it('workflowRuntime.ts log() should use _outputChannel.appendLine', () => {
        const content = readFile('src/runtime/workflowRuntime.ts');
        const logMatch = content.match(/private log\(message: string\): void \{([^}]+)\}/);
        expect(logMatch).not.toBeNull();
        expect(logMatch![1]).toContain('_outputChannel.appendLine(message)');
    });

    it('workflowRuntime.ts should still have onDidChangeExecutionState event', () => {
        const content = readFile('src/runtime/workflowRuntime.ts');
        expect(content).toContain('_onDidChangeExecutionState');
        expect(content).toContain('onDidChangeExecutionState');
    });
});
