/**
 * Multi-Workflow Project View - Feature Tests
 *
 * Validates the 0001-multi-workflow-project-view ADR spec:
 * - Project custom editor registration
 * - Explorer PROJECTS section with context menus
 * - Add/Remove workflow from project commands
 * - Toolbar buttons for project editor
 * - Run workflow from project container
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

describe('Multi-Workflow Project View (ADR 0001)', () => {
    describe('package.json contribution points', () => {
        let packageJson: any;
        beforeAll(() => {
            packageJson = JSON.parse(readFile('package.json'));
        });

        describe('customEditors', () => {
            it('should register workflowProject.editor for *.workflow-project.yaml', () => {
                const projectEditor = packageJson.contributes.customEditors.find(
                    (e: any) => e.viewType === 'workflowProject.editor'
                );
                expect(projectEditor).toBeDefined();
                expect(projectEditor.selector[0].filenamePattern).toBe('*.workflow-project.yaml');
                expect(projectEditor.displayName).toBe('Project Designer');
            });
        });

        describe('commands', () => {
            it('should register addWorkflowToProject command', () => {
                const cmd = packageJson.contributes.commands.find(
                    (c: any) => c.command === 'workflowDesigner.addWorkflowToProject'
                );
                expect(cmd).toBeDefined();
                expect(cmd.title).toBeDefined();
            });

            it('should register removeWorkflowFromProject command', () => {
                const cmd = packageJson.contributes.commands.find(
                    (c: any) => c.command === 'workflowDesigner.removeWorkflowFromProject'
                );
                expect(cmd).toBeDefined();
                expect(cmd.title).toBeDefined();
            });

            it('should register newWorkflow command', () => {
                const cmd = packageJson.contributes.commands.find(
                    (c: any) => c.command === 'workflowDesigner.newWorkflow'
                );
                expect(cmd).toBeDefined();
            });
        });

        describe('menus', () => {
            it('should have toolbar buttons for workflowProject.editor', () => {
                const editorTitleMenus = packageJson.contributes.menus['editor/title'];
                const projectEditorMenus = editorTitleMenus.filter(
                    (m: any) => m.when && m.when.includes("workflowProject.editor")
                );
                // Should have at least run, save buttons
                expect(projectEditorMenus.length).toBeGreaterThanOrEqual(2);
            });

            it('should have context menu for project tree items in explorer', () => {
                const explorerItemMenus = packageJson.contributes.menus['view/item/context'] || [];
                const projectMenus = explorerItemMenus.filter(
                    (m: any) => m.when && m.when.includes("viewItem == project")
                );
                expect(projectMenus.length).toBeGreaterThanOrEqual(1);
            });

            it('should have newWorkflow command in view/title menu', () => {
                const viewTitleMenus = packageJson.contributes.menus['view/title'] || [];
                const newWorkflowMenu = viewTitleMenus.find(
                    (m: any) => m.command === 'workflowDesigner.newWorkflow'
                );
                expect(newWorkflowMenu).toBeDefined();
            });

            it('should have addWorkflowToProject in view/item/context for project items', () => {
                const itemContextMenus = packageJson.contributes.menus['view/item/context'] || [];
                const addMenu = itemContextMenus.find(
                    (m: any) => m.command === 'workflowDesigner.addWorkflowToProject' &&
                        m.when && m.when.includes('viewItem == project')
                );
                expect(addMenu).toBeDefined();
            });

            it('should have removeWorkflowFromProject in view/item/context for project items', () => {
                const itemContextMenus = packageJson.contributes.menus['view/item/context'] || [];
                const removeMenu = itemContextMenus.find(
                    (m: any) => m.command === 'workflowDesigner.removeWorkflowFromProject' &&
                        m.when && m.when.includes('viewItem == project')
                );
                expect(removeMenu).toBeDefined();
            });
        });
    });

    describe('extension.ts commands', () => {
        let extensionSource: string;
        beforeAll(() => {
            extensionSource = readFile('src/extension.ts');
        });

        it('should register addWorkflowToProject command handler', () => {
            expect(extensionSource).toMatch(/workflowDesigner\.addWorkflowToProject/);
        });

        it('should register removeWorkflowFromProject command handler', () => {
            expect(extensionSource).toMatch(/workflowDesigner\.removeWorkflowFromProject/);
        });

        it('should register newProject command handler', () => {
            expect(extensionSource).toMatch(/workflowDesigner\.newProject/);
        });

        it('should register newWorkflow command handler', () => {
            expect(extensionSource).toMatch(/workflowDesigner\.newWorkflow/);
        });
    });

    describe('webview project mode', () => {
        let designerSource: string;
        beforeAll(() => {
            designerSource = readFile('webview/src/designer.ts');
        });

        it('should support initProject message type', () => {
            expect(designerSource).toMatch(/case\s+['"]initProject['"]/);
        });

        it('should build composite workflow from project members', () => {
            expect(designerSource).toMatch(/buildCompositeWorkflow/);
        });

        it('should draw workflow containers for each member', () => {
            expect(designerSource).toMatch(/drawWorkflowContainer/);
        });

        it('should support container collapsing via chevron click', () => {
            expect(designerSource).toMatch(/hitTestContainerChevron/);
        });

        it('should support container dragging via header', () => {
            expect(designerSource).toMatch(/hitTestContainerHeader/);
        });

        it('should detect drop target workflow from canvas position', () => {
            expect(designerSource).toMatch(/getMemberAtPosition/);
        });

        it('should notify project updates separately from workflow updates', () => {
            expect(designerSource).toMatch(/notifyProjectUpdate/);
        });
    });

    describe('explorer tree provider', () => {
        let explorerSource: string;
        beforeAll(() => {
            explorerSource = readFile('src/panels/workflowExplorer.ts');
        });

        it('should show PROJECTS section header', () => {
            expect(explorerSource).toMatch(/PROJECTS/);
        });

        it('should list .workflow-project.yaml files as project items', () => {
            expect(explorerSource).toMatch(/workflow-project\.yaml/);
        });

        it('should open project files with workflowProject.editor', () => {
            expect(explorerSource).toMatch(/workflowProject\.editor/);
        });

        it('should distinguish between workflow and project file types', () => {
            expect(explorerSource).toMatch(/kind.*project/);
        });
    });

    describe('container context menu', () => {
        let designerSource: string;
        beforeAll(() => {
            designerSource = readFile('webview/src/designer.ts');
        });

        it('should show a context menu when right-clicking a workflow container', () => {
            expect(designerSource).toMatch(/showContainerContextMenu/);
        });

        it('should include Run Workflow option in container context menu', () => {
            expect(designerSource).toMatch(/Run Workflow/);
        });

        it('should send a run message with workflowId when Run Workflow is selected', () => {
            expect(designerSource).toMatch(/type.*'run'.*workflowId|workflowId.*type.*'run'/);
        });

        it('should hide context menu on click elsewhere', () => {
            expect(designerSource).toMatch(/hideContextMenu|removeContextMenu|contextMenu.*remove|contextMenu.*hide/);
        });
    });
});
