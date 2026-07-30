import * as yaml from 'js-yaml';
import { Project, ProjectMember } from '../models/workflow';

/** Plain-object shape for YAML serialization of a project. */
interface YamlProjectObject {
    name: string;
    members?: Array<{ path: string; position: { x: number; y: number } }>;
}

/**
 * Serialize a Project object to YAML string
 */
export function projectToYaml(project: Project): string {
    const yamlObj: YamlProjectObject = {
        name: project.name,
        members: project.members.map(m => ({
            path: m.path,
            position: { x: m.position.x, y: m.position.y }
        }))
    };

    return yaml.dump(yamlObj, { lineWidth: -1, noRefs: true });
}

/**
 * Parse a YAML string into a Project object
 */
export function yamlToProject(yamlStr: string): Project {
    const obj: YamlProjectObject = yaml.load(yamlStr) as YamlProjectObject;

    const members: ProjectMember[] = [];
    if (obj.members && Array.isArray(obj.members)) {
        for (const m of obj.members) {
            members.push({
                path: m.path,
                position: {
                    x: m.position?.x || 0,
                    y: m.position?.y || 0
                }
            });
        }
    }

    return {
        name: obj.name || 'untitled-project',
        members
    };
}
