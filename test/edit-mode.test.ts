/**
 * Tests for the Edit Mode feature in the workflow designer.
 *
 * The workflow designer starts in view mode (edit mode OFF) by default.
 * Panels (toolbox and properties) are hidden, and the canvas is read-only.
 * The user can toggle Edit Mode ON to enable editing: panels appear,
 * nodes can be dragged, edges created, and nodes deleted.
 *
 * These tests verify:
 * 1. Edit Mode button exists in the toolbar HTML template
 * 2. toggleEditMode function correctly toggles state and DOM classes
 * 3. CSS transitions and .hidden states are properly defined
 * 4. Product requirements document the feature
 * 5. Edit mode guards editing interactions (drag, drop, delete)
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

// ===== Task 1: Edit Mode button in toolbar HTML =====

describe('Task 1: Edit Mode button in toolbar HTML template', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('src/designer/workflowDesignerProvider.ts');
    });

    it('should contain btn-edit-mode button element', () => {
        expect(content).toContain('id="btn-edit-mode"');
    });

    it('should have a descriptive title tooltip', () => {
        expect(content).toMatch(/id="btn-edit-mode"[^>]*title="[^"]*Edit Mode[^"]*"/i);
    });

    it('should have visible button text containing "Edit"', () => {
        expect(content).toMatch(/id="btn-edit-mode"[^>]*>.*Edit/s);
    });

    it('should be placed before the execution-status badge', () => {
        const editModeIndex = content.indexOf('btn-edit-mode');
        const statusIndex = content.indexOf('execution-status');
        expect(editModeIndex).toBeGreaterThan(-1);
        expect(statusIndex).toBeGreaterThan(-1);
        expect(editModeIndex).toBeLessThan(statusIndex);
    });

    it('should be placed after other toolbar buttons (e.g., btn-validate)', () => {
        const validateIndex = content.indexOf('btn-validate');
        const editModeIndex = content.indexOf('btn-edit-mode');
        expect(validateIndex).toBeGreaterThan(-1);
        expect(editModeIndex).toBeGreaterThan(-1);
        expect(validateIndex).toBeLessThan(editModeIndex);
    });

    it('should still contain all original toolbar buttons', () => {
        expect(content).toContain('btn-run');
        expect(content).toContain('btn-pause');
        expect(content).toContain('btn-stop');
        expect(content).toContain('btn-resume');
        expect(content).toContain('btn-save');
        expect(content).toContain('btn-validate');
    });

    it('should still contain the toolbox HTML structure', () => {
        expect(content).toContain('id="toolbox"');
        expect(content).toContain('Components');
    });

    it('should still contain the properties-panel HTML structure', () => {
        expect(content).toContain('id="properties-panel"');
    });
});

// ===== Helper: extract function body with proper brace counting =====

function extractFunctionBody(source: string, fnName: string): string | null {
    const fnStart = source.indexOf(`function ${fnName}`);
    if (fnStart < 0) return null;
    const braceStart = source.indexOf('{', fnStart);
    if (braceStart < 0) return null;
    let braceCount = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') braceCount++;
        if (source[i] === '}') braceCount--;
        if (braceCount === 0) return source.substring(braceStart + 1, i);
    }
    return null;
}

// ===== Task 2: toggleEditMode function in designer.ts =====

describe('Task 2: toggleEditMode function in webview designer.ts', () => {
    let content: string;
    let fnBody: string;

    beforeAll(() => {
        content = readFile('webview/src/designer.ts');
        fnBody = extractFunctionBody(content, 'toggleEditMode')!;
    });

    it('should have editMode state flag initialized to false', () => {
        expect(content).toMatch(/editMode:\s*false/);
    });

    it('should define a toggleEditMode function', () => {
        expect(content).toMatch(/function\s+toggleEditMode\s*\(/);
    });

    it('should toggle the editMode state flag', () => {
        expect(fnBody).toMatch(/state\.editMode\s*=\s*!\s*state\.editMode/);
    });

    it('should get references to toolbox and properties-panel elements', () => {
        expect(fnBody).toContain("getElementById('toolbox')");
        expect(fnBody).toContain("getElementById('properties-panel')");
    });

    it('should remove .hidden class from both panels when editMode is true (edit mode ON shows panels)', () => {
        expect(fnBody).toMatch(/classList\.remove\(['"]hidden['"]\)/);
    });

    it('should add .hidden class to both panels when editMode is false (edit mode OFF hides panels)', () => {
        expect(fnBody).toMatch(/classList\.add\(['"]hidden['"]\)/);
    });

    it('should toggle .active class on the button', () => {
        expect(fnBody).toMatch(/classList\.add\(['"]active['"]\)/);
        expect(fnBody).toMatch(/classList\.remove\(['"]active['"]\)/);
    });

    it('should update button text when toggled', () => {
        expect(fnBody).toMatch(/textContent\s*=/);
    });

    it('should trigger resizeCanvas after a delay for CSS transition', () => {
        expect(fnBody).toMatch(/setTimeout.*resizeCanvas/);
    });

    it('should wire up the btn-edit-mode click event listener in setupToolbar', () => {
        expect(content).toMatch(/btn-edit-mode.*toggleEditMode/);
    });
});

// ===== Task 3: CSS transitions and .hidden states =====

describe('Task 3: CSS transitions and .hidden states in designer.css', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('webview/src/designer.css');
    });

    // --- Toolbox transitions ---
    it('should have transition on #toolbox for width', () => {
        const toolboxMatch = content.match(/#toolbox\s*\{([^}]+)\}/s);
        expect(toolboxMatch).not.toBeNull();
        expect(toolboxMatch![1]).toMatch(/transition[^;]*width/);
    });

    it('should have transition on #toolbox for min-width', () => {
        const toolboxMatch = content.match(/#toolbox\s*\{([^}]+)\}/s);
        expect(toolboxMatch).not.toBeNull();
        expect(toolboxMatch![1]).toMatch(/transition[^;]*min-width/);
    });

    it('should have transition on #toolbox for padding', () => {
        const toolboxMatch = content.match(/#toolbox\s*\{([^}]+)\}/s);
        expect(toolboxMatch).not.toBeNull();
        expect(toolboxMatch![1]).toMatch(/transition[^;]*padding/);
    });

    it('should have transition on #toolbox for opacity', () => {
        const toolboxMatch = content.match(/#toolbox\s*\{([^}]+)\}/s);
        expect(toolboxMatch).not.toBeNull();
        expect(toolboxMatch![1]).toMatch(/transition[^;]*opacity/);
    });

    // --- Toolbox .hidden state ---
    it('should define #toolbox.hidden with width: 0', () => {
        const hiddenMatch = content.match(/#toolbox\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/width:\s*0/);
    });

    it('should define #toolbox.hidden with min-width: 0', () => {
        const hiddenMatch = content.match(/#toolbox\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/min-width:\s*0/);
    });

    it('should define #toolbox.hidden with overflow: hidden', () => {
        const hiddenMatch = content.match(/#toolbox\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/overflow:\s*hidden/);
    });

    it('should define #toolbox.hidden with opacity: 0', () => {
        const hiddenMatch = content.match(/#toolbox\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/opacity:\s*0/);
    });

    // --- Properties panel transitions ---
    it('should have transition on #properties-panel for width', () => {
        const panelMatch = content.match(/#properties-panel\s*\{([^}]+)\}/s);
        expect(panelMatch).not.toBeNull();
        expect(panelMatch![1]).toMatch(/transition[^;]*width/);
    });

    it('should have transition on #properties-panel for min-width', () => {
        const panelMatch = content.match(/#properties-panel\s*\{([^}]+)\}/s);
        expect(panelMatch).not.toBeNull();
        expect(panelMatch![1]).toMatch(/transition[^;]*min-width/);
    });

    it('should have transition on #properties-panel for padding', () => {
        const panelMatch = content.match(/#properties-panel\s*\{([^}]+)\}/s);
        expect(panelMatch).not.toBeNull();
        expect(panelMatch![1]).toMatch(/transition[^;]*padding/);
    });

    it('should have transition on #properties-panel for opacity', () => {
        const panelMatch = content.match(/#properties-panel\s*\{([^}]+)\}/s);
        expect(panelMatch).not.toBeNull();
        expect(panelMatch![1]).toMatch(/transition[^;]*opacity/);
    });

    // --- Properties panel .hidden state ---
    it('should define #properties-panel.hidden with width: 0', () => {
        const hiddenMatch = content.match(/#properties-panel\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/width:\s*0/);
    });

    it('should define #properties-panel.hidden with min-width: 0', () => {
        const hiddenMatch = content.match(/#properties-panel\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/min-width:\s*0/);
    });

    it('should define #properties-panel.hidden with overflow: hidden', () => {
        const hiddenMatch = content.match(/#properties-panel\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/overflow:\s*hidden/);
    });

    it('should define #properties-panel.hidden with opacity: 0', () => {
        const hiddenMatch = content.match(/#properties-panel\.hidden\s*\{([^}]+)\}/s);
        expect(hiddenMatch).not.toBeNull();
        expect(hiddenMatch![1]).toMatch(/opacity:\s*0/);
    });

    // --- Transition timing consistency ---
    it('should use consistent transition duration (0.25s) for toolbox', () => {
        const toolboxMatch = content.match(/#toolbox\s*\{([^}]+)\}/s);
        expect(toolboxMatch).not.toBeNull();
        expect(toolboxMatch![1]).toMatch(/0\.25s/);
    });

    it('should use consistent transition duration (0.25s) for properties-panel', () => {
        const panelMatch = content.match(/#properties-panel\s*\{([^}]+)\}/s);
        expect(panelMatch).not.toBeNull();
        expect(panelMatch![1]).toMatch(/0\.25s/);
    });

    // --- Active button style ---
    it('should define .active style for toolbar buttons', () => {
        expect(content).toMatch(/#toolbar\s+button\.active/);
    });

    it('should give .active button a distinct background', () => {
        const activeMatch = content.match(/#toolbar\s+button\.active\s*\{([^}]+)\}/s);
        expect(activeMatch).not.toBeNull();
        expect(activeMatch![1]).toMatch(/background/);
    });
});

// ===== Task 4: Product requirements documentation =====

describe('Task 4: Product requirements document Edit Mode', () => {
    let content: string;

    beforeAll(() => {
        content = readFile('product_requirements.md');
    });

    it('should mention Edit Mode feature', () => {
        expect(content).toMatch(/Edit Mode/i);
    });

    it('should have the Edit Mode requirement marked as completed ([x])', () => {
        expect(content).toMatch(/\[x\].*[Ee]dit [Mm]ode/);
    });

    it('should describe hiding the Components/toolbox panel', () => {
        expect(content).toMatch(/\[x\].*([Cc]omponents|toolbox).*[Hh]idden/s);
    });

    it('should describe hiding the Properties panel', () => {
        expect(content).toMatch(/\[x\].*Properties.*[Hh]idden/s);
    });

    it('should mention the canvas occupying full width', () => {
        expect(content).toMatch(/\[x\].*[Ff]ull.*[Ww]idth/s);
    });

    it('should mention the toolbar button toggle', () => {
        expect(content).toMatch(/\[x\].*[Tt]oolbar.*[Bb]utton/s);
    });
});

// ===== Task 5: Integration - no regressions =====

describe('Task 5: No regressions in existing functionality', () => {
    let designerContent: string;
    let cssContent: string;
    let providerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
        cssContent = readFile('webview/src/designer.css');
        providerContent = readFile('src/designer/workflowDesignerProvider.ts');
    });

    it('should still have the state object with all original fields', () => {
        expect(designerContent).toContain('workflow:');
        expect(designerContent).toContain('selectedNodeIds:');
        expect(designerContent).toContain('draggingNode:');
        expect(designerContent).toContain('creatingEdge:');
        expect(designerContent).toContain('panning:');
        expect(designerContent).toContain('viewport:');
        expect(designerContent).toContain('executionStatus:');
    });

    it('should still have canvas event listeners', () => {
        expect(designerContent).toMatch(/addEventListener\('mousedown',\s*onMouseDown/);
        expect(designerContent).toMatch(/addEventListener\('mousemove',\s*onMouseMove/);
        expect(designerContent).toMatch(/addEventListener\('mouseup',\s*onMouseUp/);
        expect(designerContent).toMatch(/addEventListener\('wheel',\s*onWheel/);
    });

    it('should still have the NODE_CONFIGS object', () => {
        expect(designerContent).toContain('NODE_CONFIGS');
        expect(designerContent).toContain("start:");
        expect(designerContent).toContain("agent:");
        expect(designerContent).toContain("condition:");
    });

    it('should still have the STATUS_COLORS object', () => {
        expect(designerContent).toContain('STATUS_COLORS');
    });

    it('should still have resizeCanvas function', () => {
        expect(designerContent).toMatch(/function\s+resizeCanvas/);
    });

    it('should still have updatePropertiesPanel function', () => {
        expect(designerContent).toMatch(/function\s+updatePropertiesPanel/);
    });

    it('should still have the toolbox with all node type items in HTML', () => {
        expect(providerContent).toContain('data-type="start"');
        expect(providerContent).toContain('data-type="end"');
        expect(providerContent).toContain('data-type="agent"');
        expect(providerContent).toContain('data-type="condition"');
        expect(providerContent).toContain('data-type="human_approval"');
    });

    it('should not break existing CSS selectors', () => {
        expect(cssContent).toContain('#canvas-container');
        expect(cssContent).toContain('#canvas');
        expect(cssContent).toContain('.toolbox-item');
        expect(cssContent).toContain('.properties-header');
        expect(cssContent).toContain('.status-badge');
    });

    it('should maintain the main-container flex layout', () => {
        expect(cssContent).toMatch(/#main-container[^{]*\{[^}]*display:\s*flex/s);
    });
});

// ===== Task 6: Edge cases and robustness =====

describe('Task 6: Edge cases and robustness', () => {
    let designerContent: string;

    beforeAll(() => {
        designerContent = readFile('webview/src/designer.ts');
    });

    it('should handle the button element reference (btn) in toggleEditMode', () => {
        const fnMatch = designerContent.match(/function\s+toggleEditMode\s*\([^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
        expect(fnMatch).not.toBeNull();
        const fnBody = fnMatch![1];
        expect(fnBody).toContain("getElementById('btn-edit-mode')");
    });

    it('should have an if/else structure for toggleEditMode (not just one branch)', () => {
        // Extract the function body using a more robust approach that handles nested braces
        const fnStart = designerContent.indexOf('function toggleEditMode');
        expect(fnStart).toBeGreaterThan(-1);
        let braceCount = 0;
        let fnEnd = -1;
        for (let i = designerContent.indexOf('{', fnStart); i < designerContent.length; i++) {
            if (designerContent[i] === '{') braceCount++;
            if (designerContent[i] === '}') braceCount--;
            if (braceCount === 0) { fnEnd = i; break; }
        }
        expect(fnEnd).toBeGreaterThan(-1);
        const fnBody = designerContent.substring(fnStart, fnEnd);
        expect(fnBody).toContain('if');
        expect(fnBody).toContain('else');
    });

    it('should not have duplicate editMode declarations in state', () => {
        const matches = designerContent.match(/editMode:/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
    });

    it('should not have duplicate toggleEditMode function definitions', () => {
        const matches = designerContent.match(/function\s+toggleEditMode/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
    });

    it('should have applyInitialEditMode function to hide panels on load', () => {
        expect(designerContent).toMatch(/function\s+applyInitialEditMode/);
    });

    it('should call applyInitialEditMode during init', () => {
        // Verify applyInitialEditMode is called in the init function
        const initFn = extractFunctionBody(designerContent, 'init');
        expect(initFn).toContain('applyInitialEditMode');
    });

    it('should guard node dragging behind editMode flag in onMouseDown', () => {
        const fnBody = extractFunctionBody(designerContent, 'onMouseDown')!;
        expect(fnBody).toContain('state.editMode');
    });

    it('should guard edge creation behind editMode flag in onMouseDown', () => {
        const fnBody = extractFunctionBody(designerContent, 'onMouseDown')!;
        // Creating edges (port hit test) should be guarded
        expect(fnBody).toMatch(/editMode.*hitTestOutputPorts|hitTestOutputPorts.*editMode/s);
    });

    it('should guard node deletion behind editMode flag in onKeyDown', () => {
        const fnBody = extractFunctionBody(designerContent, 'onKeyDown')!;
        expect(fnBody).toMatch(/editMode.*Delete|Delete.*editMode/s);
    });

    it('should guard toolbox drop behind editMode flag', () => {
        // The drop handler on canvasContainer should check editMode
        expect(designerContent).toMatch(/addEventListener\('drop'.*editMode/s);
    });

    it('should guard node dragging behind editMode flag in onMouseMove', () => {
        const fnBody = extractFunctionBody(designerContent, 'onMouseMove')!;
        expect(fnBody).toMatch(/draggingNode.*editMode|editMode.*draggingNode/s);
    });
});
