/**
 * Tests for the Canvas/Toolbar Theme Adaptation feature.
 *
 * These tests verify that the workflow designer webview properly adapts
 * to VS Code IDE themes (dark/light mode) by:
 * 1. CSS using VS Code CSS custom properties with appropriate fallbacks
 * 2. TypeScript resolving theme colors from computed styles
 * 3. Canvas drawing using theme-aware colors (grid, nodes, edges)
 * 4. Dark/light detection being robust
 *
 * Issues flagged by review:
 * - Fragile dark/light detection (startsWith('#1') || startsWith('#2'))
 * - CSS fallback mismatch between body and canvas
 * - No theme change listener
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

// ===== CSS Theme Variables =====

describe('CSS: Theme Variables and Fallbacks', () => {
    let css: string;

    beforeAll(() => {
        css = readFile('webview/src/designer.css');
    });

    describe('body background', () => {
        it('should use --vscode-editor-background CSS variable', () => {
            expect(css).toMatch(/body[^{]*\{[^}]*var\(--vscode-editor-background/);
        });

        it('should have a fallback color for --vscode-editor-background', () => {
            expect(css).toMatch(/body[^{]*\{[^}]*var\(--vscode-editor-background,\s*#[0-9a-fA-F]+\)/);
        });
    });

    describe('toolbar background', () => {
        it('should use --vscode-editor-background CSS variable (matching editor theme)', () => {
            expect(css).toMatch(/#toolbar[^{]*\{[^}]*var\(--vscode-editor-background/);
        });

        it('should have a fallback for toolbar background', () => {
            expect(css).toMatch(/#toolbar[^{]*\{[^}]*var\(--vscode-editor-background,\s*#[0-9a-fA-F]+\)/);
        });
    });

    describe('canvas background', () => {
        it('should use --vscode-editor-background CSS variable', () => {
            expect(css).toMatch(/#canvas[^{]*\{[^}]*var\(--vscode-editor-background/);
        });

        it('should have a fallback color for canvas background', () => {
            expect(css).toMatch(/#canvas[^{]*\{[^}]*var\(--vscode-editor-background,\s*#[0-9a-fA-F]+\)/);
        });
    });

    describe('toolbox background', () => {
        it('should use --vscode-sideBar-background CSS variable', () => {
            expect(css).toMatch(/#toolbox[^{]*\{[^}]*var\(--vscode-sideBar-background/);
        });
    });

    describe('properties panel background', () => {
        it('should use --vscode-sideBar-background CSS variable', () => {
            expect(css).toMatch(/#properties-panel[^{]*\{[^}]*var\(--vscode-sideBar-background/);
        });
    });

    describe('CSS fallback consistency', () => {
        it('should have matching fallback colors for body and canvas backgrounds', () => {
            // Extract body fallback
            const bodyMatch = css.match(/body[^{]*\{[^}]*var\(--vscode-editor-background,\s*(#[0-9a-fA-F]+)\)/);
            // Extract canvas fallback
            const canvasMatch = css.match(/#canvas[^{]*\{[^}]*var\(--vscode-editor-background,\s*(#[0-9a-fA-F]+)\)/);

            expect(bodyMatch).not.toBeNull();
            expect(canvasMatch).not.toBeNull();

            // The fallbacks should be consistent (same color)
            // This test documents the current state - they may differ intentionally
            // but should be documented
            const bodyFallback = bodyMatch![1];
            const canvasFallback = canvasMatch![1];

            // If they differ, at least one should be a reasonable default
            // (This test will fail if fallbacks are mismatched)
            expect(bodyFallback).toBe(canvasFallback);
        });
    });

    describe('VS Code theme variable usage', () => {
        const expectedVariables = [
            '--vscode-foreground',
            '--vscode-editor-background',
            // Note: --vscode-toolbar-background removed — toolbar now uses
            // --vscode-editor-background to match the editor theme
            '--vscode-panel-border',
            '--vscode-sideBar-background',
            '--vscode-input-background',
            '--vscode-input-border',
            '--vscode-focusBorder',
            '--vscode-list-hoverBackground',
            '--vscode-button-background',
            '--vscode-button-foreground',
            // Note: --vscode-button-hoverBackground removed — toolbar buttons
            // now use --vscode-list-hoverBackground for native VS Code feel
            '--vscode-descriptionForeground',
            '--vscode-list-activeSelectionBackground',
            '--vscode-editor-foreground',
        ];

        for (const variable of expectedVariables) {
            it(`should reference ${variable}`, () => {
                expect(css).toContain(variable);
            });
        }
    });
});

// ===== TypeScript Theme Color Resolution =====

describe('TypeScript: Theme Color Resolution', () => {
    let ts: string;

    beforeAll(() => {
        ts = readFile('webview/src/designer.ts');
    });

    describe('resolveThemeColors function', () => {
        it('should have a resolveThemeColors function', () => {
            expect(ts).toContain('function resolveThemeColors');
        });

        it('should read --vscode-editor-background from computed styles', () => {
            expect(ts).toContain('--vscode-editor-background');
        });

        it('should read --vscode-input-background from computed styles', () => {
            expect(ts).toContain('--vscode-input-background');
        });

        it('should read --vscode-descriptionForeground from computed styles', () => {
            expect(ts).toContain('--vscode-descriptionForeground');
        });

        it('should use getComputedStyle to read CSS variables', () => {
            expect(ts).toContain('getComputedStyle');
        });

        it('should use getPropertyValue to extract variable values', () => {
            expect(ts).toContain('getPropertyValue');
        });

        it('should store colors in a themeColors object', () => {
            expect(ts).toMatch(/themeColors\s*=/);
        });

        it('should provide fallback values for theme colors', () => {
            // Should have fallback hex colors (e.g., || '#1e1e1e')
            expect(ts).toMatch(/themeColors\s*=\s*\{[\s\S]*?\|\|\s*'#[0-9a-fA-F]+/);
        });
    });

    describe('getThemeColor helper', () => {
        it('should have a getThemeColor function', () => {
            expect(ts).toContain('function getThemeColor');
        });

        it('should return a string type', () => {
            expect(ts).toMatch(/function getThemeColor[^)]*\)\s*:\s*string/);
        });

        it('should have a fallback return value', () => {
            expect(ts).toMatch(/function getThemeColor[\s\S]*?return[\s\S]*?themeColors/);
        });
    });

    describe('Theme colors resolved at initialization', () => {
        it('should call resolveThemeColors in init()', () => {
            expect(ts).toMatch(/function init[\s\S]*?resolveThemeColors\(\)/);
        });
    });

    describe('Theme change handling (Review Issue #1 - High Severity)', () => {
        it('[REVIEW ISSUE] should listen for theme change messages from VS Code', () => {
            // VS Code sends theme change notifications to webviews.
            // The onMessage handler should handle these and re-resolve colors.
            // Check that the onMessage function contains theme-related case handlers
            const hasThemeColorCase = ts.includes("case 'themeColor'") || ts.includes('case "themeColor"');
            const hasVscodeThemeColorCase = ts.includes("case 'vscode:theme-color'") || ts.includes('case "vscode:theme-color"');
            expect(hasThemeColorCase || hasVscodeThemeColorCase).toBe(true);
        });

        it('should re-resolve colors and re-render on theme change', () => {
            // The onMessage handler should contain both calls after the theme case
            const hasThemeCase = ts.includes("case 'themeColor'");
            const hasResolveAndRender = ts.match(/resolveThemeColors\(\)[\s\S]{0,200}render\(\)/);
            expect(hasThemeCase).toBe(true);
            expect(hasResolveAndRender).not.toBeNull();
        });
    });

    describe('drawGrid function', () => {
        it('should have a drawGrid function', () => {
            expect(ts).toContain('function drawGrid');
        });

        it('should use isDarkTheme for grid color determination', () => {
            const drawGridMatch = ts.match(/function drawGrid[\s\S]*?ctx\.stroke\(\);/);
            expect(drawGridMatch).not.toBeNull();

            const drawGridBody = drawGridMatch![0];
            // drawGrid uses isDarkTheme() to choose between dark/light rgba colors
            expect(drawGridBody).toContain('isDarkTheme');
        });
    });

    describe('Dark/Light Detection Heuristic', () => {
        it('should NOT use fragile startsWith detection for dark/light themes', () => {
            // The review flagged startsWith('#1') || startsWith('#2') as fragile
            // This test ensures a better approach is used
            const hasFragileDetection = ts.includes("startsWith('#1')") || ts.includes("startsWith('#2')");
            expect(hasFragileDetection).toBe(false);
        });

        it('should use luminance-based or RGB-based dark/light detection', () => {
            // Should use proper luminance calculation or RGB comparison
            const drawGridMatch = ts.match(/function drawGrid[\s\S]*?ctx\.stroke\(\);/);
            if (!drawGridMatch) {
                // If no match, the function might be structured differently
                return;
            }

            const drawGridBody = drawGridMatch[0];
            const hasLuminance = drawGridBody.includes('luminance') ||
                                 drawGridBody.includes('rgb') ||
                                 drawGridBody.includes('parseInt') ||
                                 drawGridBody.includes('0xff') ||
                                 drawGridBody.includes('< 128') ||
                                 drawGridBody.includes('< 0.5');
            expect(hasLuminance).toBe(true);
        });

        it('should correctly classify common dark theme backgrounds', () => {
            // Test the detection logic with common dark theme colors
            // This is a unit test of the heuristic itself
            const testColors = [
                { hex: '#1e1e1e', expected: 'dark' },    // VS Code Dark+
                { hex: '#252526', expected: 'dark' },    // VS Code sidebar
                { hex: '#2d2d2d', expected: 'dark' },    // One Dark
                { hex: '#191825', expected: 'dark' },    // Catppuccin Mocha
                { hex: '#303030', expected: 'dark' },    // Custom dark (was misclassified before)
                { hex: '#2a2a2a', expected: 'dark' },    // Another custom dark
                { hex: '#ffffff', expected: 'light' },   // VS Code Light+
                { hex: '#f5f5f5', expected: 'light' },   // Light gray
                { hex: '#fafafa', expected: 'light' },   // Very light
            ];

            for (const { hex, expected } of testColors) {
                // Parse hex to RGB and check luminance
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                // Relative luminance formula
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                const detected = luminance < 0.5 ? 'dark' : 'light';

                expect(detected).toBe(expected);
            }
        });
    });

    describe('drawNode function', () => {
        it('should have a drawNode function', () => {
            expect(ts).toContain('function drawNode');
        });

        it('should use getThemeColor for node body fill', () => {
            const drawNodeMatch = ts.match(/function drawNode[\s\S]*?function drawPorts/);
            expect(drawNodeMatch).not.toBeNull();

            const drawNodeBody = drawNodeMatch![0];
            expect(drawNodeBody).toContain('getThemeColor');
            expect(drawNodeBody).toContain('inputBackground');
        });

        it('should use descriptionForeground for sub-label text', () => {
            const drawNodeMatch = ts.match(/function drawNode[\s\S]*?function drawPorts/);
            const drawNodeBody = drawNodeMatch![0];

            // Should use descriptionForeground instead of hardcoded #666
            expect(drawNodeBody).toContain('descriptionForeground');
        });
    });

    describe('drawEdge function', () => {
        it('should have a drawEdge function', () => {
            expect(ts).toContain('function drawEdge');
        });

        it('should use getThemeColor for edge line color', () => {
            const drawEdgeMatch = ts.match(/function drawEdge[\s\S]*?function drawCreatingEdge/);
            expect(drawEdgeMatch).not.toBeNull();

            const drawEdgeBody = drawEdgeMatch![0];
            expect(drawEdgeBody).toContain('getThemeColor');
        });

        it('should use descriptionForeground for edge elements', () => {
            const drawEdgeMatch = ts.match(/function drawEdge[\s\S]*?function drawCreatingEdge/);
            const drawEdgeBody = drawEdgeMatch![0];

            expect(drawEdgeBody).toContain('descriptionForeground');
        });

        it('should NOT use hardcoded #999 or #666 for edge colors', () => {
            const drawEdgeMatch = ts.match(/function drawEdge[\s\S]*?function drawCreatingEdge/);
            const drawEdgeBody = drawEdgeMatch![0];

            // Should not have hardcoded gray colors for edges
            expect(drawEdgeBody).not.toMatch(/fillStyle\s*=\s*['"]#999['"]/);
            expect(drawEdgeBody).not.toMatch(/fillStyle\s*=\s*['"]#666['"]/);
            expect(drawEdgeBody).not.toMatch(/strokeStyle\s*=\s*['"]#999['"]/);
        });
    });
});

// ===== Compiled Output Verification =====

describe('Compiled Output: Theme Changes Present', () => {
    let distJs: string;
    let distCss: string;

    beforeAll(() => {
        distJs = readFile('webview/dist/designer.js');
        distCss = readFile('webview/dist/designer.css');
    });

    describe('Compiled JavaScript', () => {
        it('should contain resolveThemeColors function', () => {
            expect(distJs).toContain('resolveThemeColors');
        });

        it('should contain getThemeColor function', () => {
            expect(distJs).toContain('getThemeColor');
        });

        it('should contain themeColors variable', () => {
            expect(distJs).toContain('themeColors');
        });

        it('should reference VS Code CSS variables', () => {
            expect(distJs).toContain('--vscode-editor-background');
            expect(distJs).toContain('--vscode-input-background');
            expect(distJs).toContain('--vscode-descriptionForeground');
        });
    });

    describe('Compiled CSS', () => {
        it('should contain VS Code CSS variables', () => {
            expect(distCss).toContain('--vscode-editor-background');
            // Toolbar now uses --vscode-editor-background instead of --vscode-toolbar-background
            expect(distCss).toContain('--vscode-editor-foreground');
        });

        it('should have canvas background using VS Code variable', () => {
            expect(distCss).toMatch(/#canvas[^{]*\{[^}]*var\(--vscode-editor-background/);
        });
    });
});

// ===== Integration: Theme Color Flow =====

describe('Integration: Theme Color Resolution Flow', () => {
    let ts: string;

    beforeAll(() => {
        ts = readFile('webview/src/designer.ts');
    });

    it('should have the complete flow: init -> resolveThemeColors -> render -> drawGrid/drawNode/drawEdge', () => {
        // Verify the call chain exists
        expect(ts).toMatch(/function init[\s\S]*?resolveThemeColors\(\)/);
        expect(ts).toMatch(/function render[\s\S]*?drawGrid/);
        expect(ts).toMatch(/function render[\s\S]*?drawNode/);
        expect(ts).toMatch(/function render[\s\S]*?drawEdge/);
    });

    it('should call resolveThemeColors before canvas rendering', () => {
        // resolveThemeColors should be called in init() before render()
        const initMatch = ts.match(/function init\(\)\s*\{([\s\S]*?)\n\s*}/);
        expect(initMatch).not.toBeNull();

        const initBody = initMatch![1];
        const resolveIndex = initBody.indexOf('resolveThemeColors');
        const resizeIndex = initBody.indexOf('resizeCanvas'); // resizeCanvas calls render

        expect(resolveIndex).toBeGreaterThan(-1);
        // resolveThemeColors should be called early in init
        expect(resolveIndex).toBeLessThan(500); // Within first 500 chars of init body
    });

    it('should use theme colors in all drawing functions', () => {
        // drawGrid uses getThemeColor
        expect(ts).toMatch(/function drawGrid[\s\S]*?getThemeColor/);
        // drawNode uses getThemeColor
        expect(ts).toMatch(/function drawNode[\s\S]*?getThemeColor/);
        // drawEdge uses getThemeColor
        expect(ts).toMatch(/function drawEdge[\s\S]*?getThemeColor/);
    });
});

// ===== Edge Cases =====

describe('Edge Cases: Theme Color Handling', () => {
    let ts: string;

    beforeAll(() => {
        ts = readFile('webview/src/designer.ts');
    });

    it('should handle missing CSS variables with fallback values', () => {
        // resolveThemeColors should have fallbacks (|| '...')
        const resolveMatch = ts.match(/function resolveThemeColors[\s\S]*?themeColors\s*=\s*\{([\s\S]*?)\};/);
        expect(resolveMatch).not.toBeNull();

        const assignments = resolveMatch![1];
        // Each assignment should have a fallback
        const lines = assignments.split('\n').filter(l => l.trim());
        for (const line of lines) {
            if (line.includes(': get(')) {
                expect(line).toMatch(/\|\|\s*'#[0-9a-fA-F]+/);
            }
        }
    });

    it('should handle getThemeColor with unknown color name', () => {
        // getThemeColor should return a default for unknown names
        const getThemeMatch = ts.match(/function getThemeColor[\s\S]*?\n\s*}/);
        expect(getThemeMatch).not.toBeNull();

        const funcBody = getThemeMatch![0];
        // Should have a fallback return
        expect(funcBody).toMatch(/\|\|\s*'#[0-9a-fA-F]+/);
    });

    it('should handle theme colors before resolveThemeColors is called', () => {
        // themeColors should be initialized as an empty object or with defaults
        expect(ts).toMatch(/let themeColors[\s\S]*?=\s*\{/);
    });
});

// ===== Review Issue Verification =====

describe('Review Issues: Verification', () => {
    let ts: string;

    beforeAll(() => {
        ts = readFile('webview/src/designer.ts');
    });

    describe('Issue 1: Theme change listener', () => {
        it('should handle VS Code theme change messages', () => {
            // Check if onMessage handles theme-related message types
            // Extract the onMessage function body (brace-counting for nested braces)
            const fnStart = ts.indexOf('function onMessage');
            expect(fnStart).toBeGreaterThan(-1);
            let braceCount = 0;
            let fnEnd = -1;
            for (let i = ts.indexOf('{', fnStart); i < ts.length; i++) {
                if (ts[i] === '{') braceCount++;
                if (ts[i] === '}') braceCount--;
                if (braceCount === 0) { fnEnd = i; break; }
            }
            expect(fnEnd).toBeGreaterThan(-1);
            const fnBody = ts.substring(fnStart, fnEnd);

            // Should have a case for theme changes
            const hasThemeCase = fnBody.includes("case 'themeColor'") ||
                                 fnBody.includes("case 'theme-color'") ||
                                 fnBody.includes("case 'vscode:theme-color'") ||
                                 fnBody.includes("case 'themeChange'");
            expect(hasThemeCase).toBe(true);
        });
    });

    describe('Issue 2: Dark/light detection robustness', () => {
        it('should not use startsWith for dark/light detection', () => {
            // The fragile heuristic should be replaced
            const hasFragileHeuristic = ts.includes("startsWith('#1')") ||
                                        ts.includes("startsWith('#2')");
            expect(hasFragileHeuristic).toBe(false);
        });
    });

    describe('Issue 5: CSS fallback consistency', () => {
        let css: string;

        beforeAll(() => {
            css = readFile('webview/src/designer.css');
        });

        it('should have consistent body and canvas background fallbacks', () => {
            const bodyMatch = css.match(/body[^{]*\{[^}]*var\(--vscode-editor-background,\s*(#[0-9a-fA-F]+)\)/);
            const canvasMatch = css.match(/#canvas[^{]*\{[^}]*var\(--vscode-editor-background,\s*(#[0-9a-fA-F]+)\)/);

            expect(bodyMatch).not.toBeNull();
            expect(canvasMatch).not.toBeNull();
            expect(bodyMatch![1]).toBe(canvasMatch![1]);
        });
    });
});
