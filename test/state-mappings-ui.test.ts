/**
 * Tests for the State Read/Write Mappings UI in the Agent node properties panel.
 *
 * Verifies that the workflow designer webview properly supports configuring
 * state write mappings for Agent nodes:
 * 1. Properties panel renders a "State Mappings" section for Agent nodes
 * 2. Each mapping displays source → target
 * 3. Add Mapping button is present
 * 4. Remove button exists per mapping
 * 5. Input fields for source and target in new mapping forms
 * 6. Changes are sent via postMessage to the extension
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

describe('State Mappings UI in Properties Panel', () => {
    let designerTs: string;
    let designerCss: string;

    beforeAll(() => {
        designerTs = readFile('webview/src/designer.ts');
        designerCss = readFile('webview/src/designer.css');
    });

    describe('updatePropertiesPanel for Agent nodes', () => {
        it('should include a State Mappings section in the Agent node properties', () => {
            expect(designerTs).toMatch(/State\s*Mappings/i);
        });

        it('should reference stateWrites in the properties panel rendering', () => {
            expect(designerTs).toMatch(/stateWrites/i);
        });

        it('should render an "Add Mapping" button for Agent nodes', () => {
            expect(designerTs).toMatch(/Add\s*Mapping/i);
        });

        it('should iterate over stateWrites mappings when rendering', () => {
            // Should have a loop or forEach over mappings (derived from stateWrites)
            expect(designerTs).toMatch(/mappings\.forEach|stateWrites.*forEach|for\s*\(.*stateWrites|stateWrites\s*\?\s*\[\]/);
        });
    });

    describe('Mapping entry rendering', () => {
        it('should display source field for each mapping', () => {
            expect(designerTs).toMatch(/mapping\.source|\.source/i);
        });

        it('should display target field for each mapping', () => {
            expect(designerTs).toMatch(/mapping\.target|\.target/i);
        });

        it('should show an arrow or separator between source and target', () => {
            // Arrow (→) or similar separator between source and target display
            expect(designerTs).toMatch(/→|->|\s*→\s*/);
        });

        it('should include a remove button for each mapping', () => {
            expect(designerTs).toMatch(/remove.*mapping|removeMapping|Remove.*Mapping/i);
        });
    });

    describe('Add mapping functionality', () => {
        it('should have an addMapping function or handler', () => {
            expect(designerTs).toMatch(/addMapping|add.*mapping/i);
        });

        it('should add a new empty mapping to stateWrites array', () => {
            // Should push or concat a new { source: '', target: '' } object
            expect(designerTs).toMatch(/push.*source.*target|stateWrites.*=.*stateWrites.*concat|(\{[\s]*source[\s]*:[\s]*['"]['"]|source[\s]*:[\s]*['"]['"])/);
        });

        it('should call saveHistory after adding a mapping', () => {
            expect(designerTs).toMatch(/addMapping[\s\S]{0,1000}saveHistory/);
        });

        it('should call notifyWorkflowUpdate after adding a mapping', () => {
            expect(designerTs).toMatch(/addMapping[\s\S]{0,1000}notifyWorkflowUpdate/);
        });
    });

    describe('Remove mapping functionality', () => {
        it('should have a removeMapping function or handler', () => {
            expect(designerTs).toMatch(/removeMapping|remove.*mapping/i);
        });

        it('should filter out the mapping by index', () => {
            expect(designerTs).toMatch(/filter.*index|\.filter\s*\(/);
        });

        it('should call saveHistory after removing a mapping', () => {
            expect(designerTs).toMatch(/removeMapping[\s\S]{0,1000}saveHistory/);
        });
    });

    describe('Edit mapping functionality', () => {
        it('should have an updateMappingSource or similar handler for source changes', () => {
            expect(designerTs).toMatch(/updateMapping.*source|onMappingSourceChange|mapping.*source.*change/i);
        });

        it('should have an updateMappingTarget or similar handler for target changes', () => {
            expect(designerTs).toMatch(/updateMapping.*target|onMappingTargetChange|mapping.*target.*change/i);
        });

        it('should send mapping changes via postMessage', () => {
            expect(designerTs).toMatch(/updateMapping[\s\S]{0,1000}notifyWorkflowUpdate/);
        });
    });

    describe('New mapping input fields', () => {
        it('should render input fields for source and target when editing a mapping', () => {
            expect(designerTs).toMatch(/input.*mapping.*source|mapping.*source.*input/i);
            expect(designerTs).toMatch(/input.*mapping.*target|mapping.*target.*input/i);
        });
    });

    describe('CSS for state mappings', () => {
        it('should have CSS classes for mapping entries', () => {
            expect(designerCss).toMatch(/mapping-entry|mapping-item|state-mapping/i);
        });

        it('should have CSS for mapping input fields', () => {
            expect(designerCss).toMatch(/mapping.*input|mapping-input/i);
        });
    });

    describe('Global function exposure for onclick handlers', () => {
        it('should expose addMapping on window for onclick access', () => {
            expect(designerTs).toMatch(/window\.addMapping/i);
        });

        it('should expose removeMapping on window for onclick access', () => {
            expect(designerTs).toMatch(/window\.removeMapping/i);
        });
    });
});

describe('StateWriteMapping model', () => {
    let workflowTs: string;

    beforeAll(() => {
        workflowTs = readFile('src/models/workflow.ts');
    });

    it('should define StateWriteMapping interface with source and target', () => {
        expect(workflowTs).toMatch(/StateWriteMapping/);
        expect(workflowTs).toMatch(/source.*string/);
        expect(workflowTs).toMatch(/target.*string/);
    });

    it('should include stateWrites in AgentNodeData', () => {
        expect(workflowTs).toMatch(/AgentNodeData[\s\S]{0,500}stateWrites/);
    });
});

describe('YAML serialization of stateWrites', () => {
    let yamlSerializer: string;

    beforeAll(() => {
        yamlSerializer = readFile('src/utils/yamlSerializer.ts');
    });

    it('should serialize stateWrites for Agent nodes', () => {
        expect(yamlSerializer).toMatch(/stateWrites/);
    });

    it('should deserialize stateWrites when loading YAML', () => {
        expect(yamlSerializer).toMatch(/stateWrites/);
    });
});
