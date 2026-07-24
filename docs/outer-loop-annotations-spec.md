# Outer Loop Annotations — Implementation Spec

**Date:** 2026-07-22
**Status:** Ready for implementation

## Summary

Add three non-executable node types (Note, Process, Decision) to the workflow designer. These are visual annotations that provide context about how the inner loop (software factory) fits into broader business processes. They share the same canvas and graph model as executable nodes but are completely invisible to the runtime.

## Design Decisions

- **Three types:** Note (simple text), Process (title + description), Decision (question + optional options)
- **Visual distinction:** Muted color palette + dashed borders (vs. vibrant colors + solid borders for executable nodes)
- **Toolbox:** Same toolbox, new "Annotations" section grouping these three types
- **Edges:** Outer loop nodes can connect to inner loop nodes via visual-only edges
- **Runtime:** Outer loop nodes are invisible to the executor — no execution records, no state changes, no traversal
- **Validation:** Outer loop nodes do not need to be reachable from Start

## Changes by File

### 1. `src/models/workflow.ts`

- Add three new values to `NodeType` enum: `Note = 'note'`, `Process = 'process'`, `Decision = 'decision'`
- Add three new data interfaces:
  - `NoteNodeData { text: string; description?: string }`
  - `ProcessNodeData { title: string; description?: string }`
  - `DecisionNodeData { question: string; options?: string[] }`
- Union these into `NodeData`
- Add helper: `function isAnnotationNode(type: NodeType): boolean` returning true for note/process/decision

### 2. `src/utils/yamlSerializer.ts`

- In `workflowToYaml`: handle new node types (serialize their data fields)
- In `yamlToWorkflow`: deserialize new node types from YAML back to Node objects

### 3. `src/utils/workflowValidator.ts`

- Exclude annotation nodes from reachability validation (they don't need to be reachable from Start)
- Exclude annotation nodes from orphan node warnings
- Annotation nodes should not count toward "exactly one Start" or "at least one End" checks

### 4. `src/runtime/workflowExecutor.ts` (or wherever traversal happens)

- When traversing the graph, skip annotation nodes entirely
- When computing next nodes from edges, filter out edges that target annotation nodes
- Ensure annotation nodes never get Node Execution Records

### 5. `webview/src/designer.ts`

- Add three new node types to the toolbox under a new "Annotations" section
- Implement rendering for each type:
  - **Note:** Simple card with text content, muted background, dashed border
  - **Process:** Card with title (bold) + description, muted background, dashed border
  - **Decision:** Diamond-shaped node with question text, muted background, dashed border
- Support dragging annotation nodes from toolbox onto canvas
- Support creating edges from annotation nodes to any node type (including executable nodes)
- Support selecting, moving, and deleting annotation nodes
- Support editing annotation node properties in the properties panel

### 6. `webview/src/designer.css`

- Add CSS classes for annotation node styling (muted colors, dashed borders)
- Add diamond shape for Decision nodes
- Style the "Annotations" section in the toolbox

### 7. `src/designer/workflowDesignerProvider.ts`

- Ensure new node types are included in any node type lists sent to the webview

## Acceptance Criteria

- [ ] Can drag Note, Process, and Decision nodes from toolbox onto canvas
- [ ] Annotation nodes render with muted colors and dashed borders
- [ ] Decision nodes render as diamond shapes
- [ ] Can create edges from annotation nodes to executable nodes
- [ ] Can edit annotation node properties in the properties panel
- [ ] Annotation nodes serialize to and deserialize from YAML correctly
- [ ] Running a workflow with annotation nodes does not execute them
- [ ] Validation passes even if annotation nodes are unreachable from Start
- [ ] Annotation nodes can be selected, moved, and deleted like regular nodes

## Domain Model Updates (CONTEXT.md)

Add these terms:

**Outer Loop**:
The human-driven process of articulating business needs, making decisions, and defining requirements that feed into the inner loop (software factory). Outer loop nodes are visual annotations on the workflow canvas that provide context but are never executed.
_Avoid_: Business workflow, requirement flow, planning phase

**Annotation Node**:
A non-executable Node (Note, Process, or Decision) that provides visual context on the canvas. Annotation Nodes are serialized to YAML but ignored by the Runtime. They may have Edges pointing to executable Nodes to show relationships.
_Avoid_: Sticky note, comment, label, metadata node
