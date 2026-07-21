/**
 * Tests for configurable workflow animation timings.
 *
 * Public seams under test:
 * 1) Extension settings schema (package.json contributes.configuration)
 * 2) Webview init contract from provider -> designer
 * 3) Designer runtime behavior uses config values instead of hardcoded durations
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

describe('Animation timing configuration', () => {
    let pkg: any;
    let providerTs: string;
    let designerTs: string;

    beforeAll(() => {
        pkg = JSON.parse(readFile('package.json'));
        providerTs = readFile('src/designer/workflowDesignerProvider.ts');
        designerTs = readFile('webview/src/designer.ts');
    });

    it('should contribute settings for animation timing values', () => {
        const settings = pkg?.contributes?.configuration?.properties;
        expect(settings).toBeDefined();
        expect(settings['workflowDesigner.animation.startNodeFlashMs']).toBeDefined();
        expect(settings['workflowDesigner.animation.edgeHandoffMs']).toBeDefined();
        expect(settings['workflowDesigner.animation.endNodeFlashMs']).toBeDefined();
        expect(settings['workflowDesigner.animation.edgeDashSpeed']).toBeDefined();
    });

    it('should send animationConfig in init webview message', () => {
        expect(providerTs).toContain('animationConfig');
        expect(providerTs).toContain("type: 'init'");
    });

    it('should hold animationConfig in designer state with defaults', () => {
        expect(designerTs).toContain('animationConfig:');
        expect(designerTs).toContain('startNodeFlashMs');
        expect(designerTs).toContain('edgeHandoffMs');
        expect(designerTs).toContain('endNodeFlashMs');
        expect(designerTs).toContain('edgeDashSpeed');
    });

    it('should apply init animationConfig from provider in onMessage init', () => {
        expect(designerTs).toMatch(/case 'init'[\s\S]*animationConfig/);
    });

    it('should use configured durations instead of hardcoded values', () => {
        expect(designerTs).toContain('state.animationConfig.startNodeFlashMs');
        expect(designerTs).toContain('state.animationConfig.edgeHandoffMs');
        expect(designerTs).toContain('state.animationConfig.endNodeFlashMs');
        expect(designerTs).toContain('state.animationConfig.edgeDashSpeed');
    });
});
