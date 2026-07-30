import { projectToYaml, yamlToProject } from '../src/utils/projectSerializer';
import { Project } from '../src/models/workflow';

describe('Project YAML Serializer', () => {
    describe('projectToYaml', () => {
        it('should serialize a project to YAML', () => {
            const project: Project = {
                name: 'My Project',
                members: [
                    { path: './workflow-a.workflow.yaml', position: { x: 0, y: 0 } },
                    { path: './workflow-b.workflow.yaml', position: { x: 800, y: 0 } }
                ]
            };

            const yaml = projectToYaml(project);

            expect(yaml).toContain('name: My Project');
            expect(yaml).toContain('workflow-a.workflow.yaml');
            expect(yaml).toContain('workflow-b.workflow.yaml');
        });

        it('should serialize an empty project', () => {
            const project: Project = {
                name: 'Empty',
                members: []
            };

            const yaml = projectToYaml(project);

            expect(yaml).toContain('name: Empty');
        });
    });

    describe('yamlToProject', () => {
        it('should parse a YAML string into a Project', () => {
            const yamlStr = `name: My Project
members:
  - path: ./workflow-a.workflow.yaml
    position:
      x: 0
      y: 0
  - path: ./workflow-b.workflow.yaml
    position:
      x: 800
      y: 0
`;

            const project = yamlToProject(yamlStr);

            expect(project.name).toBe('My Project');
            expect(project.members).toHaveLength(2);
            expect(project.members[0].path).toBe('./workflow-a.workflow.yaml');
            expect(project.members[0].position).toEqual({ x: 0, y: 0 });
            expect(project.members[1].position.x).toBe(800);
        });

        it('should handle empty members', () => {
            const yamlStr = `name: Empty
members: []
`;

            const project = yamlToProject(yamlStr);

            expect(project.name).toBe('Empty');
            expect(project.members).toHaveLength(0);
        });

        it('should handle missing members field', () => {
            const yamlStr = `name: Minimal
`;

            const project = yamlToProject(yamlStr);

            expect(project.name).toBe('Minimal');
            expect(project.members).toHaveLength(0);
        });
    });

    describe('round-trip', () => {
        it('should survive serialize → deserialize', () => {
            const original: Project = {
                name: 'Round Trip',
                members: [
                    { path: './test.workflow.yaml', position: { x: 100, y: 200 } }
                ]
            };

            const yaml = projectToYaml(original);
            const restored = yamlToProject(yaml);

            expect(restored.name).toBe(original.name);
            expect(restored.members).toHaveLength(original.members.length);
            expect(restored.members[0].path).toBe(original.members[0].path);
            expect(restored.members[0].position).toEqual(original.members[0].position);
        });
    });
});
