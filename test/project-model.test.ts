import { Project, ProjectMember, isProjectFile } from '../src/models/workflow';

describe('Project Model', () => {
    describe('Project interface', () => {
        it('should accept a valid project with members', () => {
            const project: Project = {
                name: 'My Project',
                members: [
                    {
                        path: './workflow-a.workflow.yaml',
                        position: { x: 0, y: 0 }
                    },
                    {
                        path: './workflow-b.workflow.yaml',
                        position: { x: 800, y: 0 }
                    }
                ]
            };

            expect(project.name).toBe('My Project');
            expect(project.members).toHaveLength(2);
            expect(project.members[0].path).toBe('./workflow-a.workflow.yaml');
            expect(project.members[1].position.x).toBe(800);
        });

        it('should accept a project with an empty members list', () => {
            const project: Project = {
                name: 'Empty Project',
                members: []
            };

            expect(project.members).toHaveLength(0);
        });
    });

    describe('ProjectMember interface', () => {
        it('should have path and position', () => {
            const member: ProjectMember = {
                path: './test.workflow.yaml',
                position: { x: 100, y: 200 }
            };

            expect(member.path).toBe('./test.workflow.yaml');
            expect(member.position).toEqual({ x: 100, y: 200 });
        });
    });

    describe('isProjectFile', () => {
        it('should return true for .workflow-project.yaml files', () => {
            expect(isProjectFile('my-project.workflow-project.yaml')).toBe(true);
            expect(isProjectFile('./path/to/project.workflow-project.yaml')).toBe(true);
        });

        it('should return false for regular workflow files', () => {
            expect(isProjectFile('my-workflow.workflow.yaml')).toBe(false);
        });

        it('should return false for non-workflow files', () => {
            expect(isProjectFile('readme.md')).toBe(false);
            expect(isProjectFile('config.json')).toBe(false);
        });
    });
});
