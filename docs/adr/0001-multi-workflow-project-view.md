# 0001 — Multi-Workflow Project View

The designer currently supports one Workflow per Canvas (one `*.workflow.yaml` per editor tab). Users need to see and edit multiple Workflows together on a shared canvas to understand how they relate spatially.

We introduced a new domain concept — **Project** — stored as `*.workflow-project.yaml`. A Project is a collection of Workflows viewed and edited together on a single Canvas. Workflows within a Project remain independent execution units; there are no cross-workflow edges.

## Why a separate file, not an enhanced designer?

We considered enhancing the existing designer with an "Add Workflow" button, but a dedicated Project file gives us: explicit serializable state (membership + positions), a clean domain term, and natural setup for future workflow sequencing. It also preserves the existing single-workflow editor unchanged — no risk to the current UX.

## Key decisions

- **Group containers** — each workflow renders inside a labeled, draggable, collapsible container on the canvas. Auto-sized to content.
- **Inline editing** — dropping a node from the toolbox into a container adds it to that workflow. Save writes to individual `.workflow.yaml` files; the Project file only tracks membership and positions.
- **Execution** — right-click a container → "Run Workflow". The Runtime stays single-workflow; no multi-workflow traversal.
- **Explorer** — new "PROJECTS" section alongside "WORKFLOWS", with a "New Project" command.
- **File location** — `*.workflow-project.yaml` lives in `.github/workflows/` alongside regular workflows.
- **Workflow reuse** — a workflow can belong to multiple projects; paths are relative to the Project file.

## Consequences

- New custom editor type (`workflowProject.editor`) alongside the existing `workflowDesigner.editor`.
- The webview designer gains multi-workflow state, container rendering, and drop-target detection.
- The Runtime requires no changes — execution remains single-workflow.
- Future sequencing (workflow A triggers workflow B) can be layered on top of the Project model by adding an `executionOrder` field to the Project file.
