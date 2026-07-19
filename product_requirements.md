# Product Requirements Document (PRD)

# VS Code Agent Workflow Designer & Runtime

**Version:** 0.3 (Prototype)

**Status:** Draft — Genuine Copilot subagent runtime implemented 2026-07-19

**Author:** OpenAI

---

# 0. Implementation Status

This checklist was reconciled against the extension source on 2026-07-19. A checked item is implemented and connected to the user-facing workflow. An unchecked item is missing, only partially implemented, or present as unreachable scaffolding.

## Visual Workflow Designer

- [x] Register a custom VS Code editor for `*.workflow.yaml` files.
- [x] Render Start, End, Agent, Condition, Human Approval, and Delay nodes on a visual canvas.
- [x] Drag nodes from the toolbox and drop them at snapped canvas coordinates.
- [x] Select a node by clicking it and select multiple nodes with Shift+Click.
- [ ] Select one or more nodes by dragging a selection box.
- [x] Delete selected nodes and their attached edges with Delete or Backspace.
- [ ] Copy and paste nodes and their connections.
- [x] Undo and redo workflow edits with a bounded in-memory history.
- [x] Pan the canvas, zoom with the mouse wheel, display a grid, and snap nodes to the grid.
- [x] Create connections by dragging between ports with a rubber-band preview.
- [x] Reject self-connections, duplicate connections, connections into Start, and connections out of End.
- [ ] Select and delete an individual connection.
- [ ] Edit a connection label after creating it.
- [ ] Configure or apply connection priority.
- [x] Enforce at most one Start node in the toolbox and validate that exactly one Start exists.
- [x] Allow multiple End nodes and warn when no End node exists.
- [x] Toggle **Edit Mode** via a toolbar button; when enabled, the Components (toolbox) and Properties panels are hidden so the canvas occupies the full available width. Useful for viewing the entire workflow while it runs, especially with the chat window open on the right.

## Node Configuration

- [x] Edit Start and End labels.
- [x] Edit an Agent node's agent name/path, model hint, prompt, timeout, and retry count.
- [ ] Choose an Agent node's agent file using a file browser or discovered-agent picker.
- [ ] Edit the documented node description fields in the properties panel.
- [x] Edit a Condition node's expression.
- [x] Edit a Human Approval node's prompt message.
- [x] Edit a Delay node's duration.
- [ ] Configure state read/write mappings in the properties panel.
- [x] Persist supported node properties when saving and loading YAML.

## Workflow Files and Validation

- [x] Serialize the visual workflow to YAML and deserialize YAML back into the visual model.
- [x] Save with the designer Save button or `Ctrl+S` and load when the file is opened.
- [x] Support VS Code custom-document save-as, revert, and backup operations.
- [x] Validate duplicate node IDs, Start/End presence, edge references, self-connections, duplicate edges, orphan nodes, required Agent/Condition data, and Condition output count.
- [x] Show validation results through VS Code notifications.
- [ ] Publish validation errors to the VS Code Problems panel or display them inline on the graph.
- [ ] Provide the documented **Generate Configuration** toolbar action as a distinct command.
- [ ] Support configurable automatic saving after edits.

## Workflow Runtime and State

- [x] Load, validate, and execute a sequential Start → Agent/Delay → End workflow locally in VS Code.
- [x] Track Waiting, Running, Completed, Failed, and Paused node records in memory.
- [x] Maintain a global in-memory state bag and pass its current values to Agent nodes.
- [x] Store every successful Agent result under `<node-id>_output` and `<node-id>_success` state keys.
- [x] Apply code-defined Agent `stateWrites` mappings from JSON or raw output to workflow state.
- [ ] Define initial workflow state in the YAML schema.
- [ ] Persist an in-progress execution state to disk and restore it after VS Code restarts.
- [x] Evaluate Condition expressions against state with boolean, numeric, string, comparison, and logical operators.
- [ ] Follow only the True or False edge selected by a Condition result. The runtime currently evaluates and logs the result but schedules every outgoing edge.
- [ ] Support merge points without executing the merged node once per incoming branch.
- [ ] Mark the branch not taken as Skipped.

## Agent Integration

- [x] Discover `.agent.md` files in `.github/agents/`.
- [x] Parse agent frontmatter and instructions.
- [x] Run every Agent node as a genuine GitHub Copilot subagent through VS Code's `runSubagent` tool.
- [x] Start workflow execution inside a Copilot Chat participant request so every subagent invocation receives a valid `toolInvocationToken`.
- [x] Select the requested custom agent with the native `agentName` parameter and let VS Code load that agent's instructions, tools, hooks, and model configuration.
- [x] Fail closed with a clear diagnostic when Copilot, `runSubagent`, the requested custom agent, or a valid chat context is unavailable.
- [x] Never silently substitute a direct Language Model API request or extension-owned agent loop for a required Copilot subagent.
- [x] Capture genuine Copilot subagent output for workflow state and execution records.
- [x] Enforce Agent timeout and retry settings.
- [ ] Capture complete tool-usage records and context produced in node execution details.

## Loops and Exit Criteria

- [x] Detect whether a workflow graph contains a cycle through the validator utility API.
- [ ] Execute cyclic graphs safely with per-loop iteration tracking. The runtime's iteration counter and maximum-loop fields are not connected to graph traversal.
- [ ] Enforce a configurable maximum iteration count.
- [ ] Exit a loop on a boolean condition.
- [ ] Exit a loop on a quality score threshold.
- [ ] Exit a loop on human approval.
- [ ] Exit a loop on a wall-clock timeout.
- [ ] Exit a loop when a budget is exhausted.

## Human Interaction and Execution Controls

- [x] Pause at a Human Approval node and show modal Approve and Reject actions.
- [x] Store a Human Approval result in workflow state.
- [ ] Route approval to the True path and rejection to the False path. A rejection currently fails the node and ends that path.
- [ ] Pause execution at the next node boundary when the Pause control is used. The current control changes status but traversal continues.
- [ ] Resume a workflow that was actually halted by Pause.
- [x] Stop scheduling new nodes after a Stop request and interrupt an active Delay node.
- [x] Immediately cancel an Agent invocation already in progress when Stop is requested.
- [ ] Persist a paused execution across VS Code restarts.
- [ ] Support manual intervention beyond Approve or Reject.

## Live Execution and Debugging

- [x] Provide Run, Pause, Stop, Resume, Save, and Validate toolbar controls.
- [x] Show overall execution status in the VS Code status bar.
- [x] Color nodes for Waiting, Running, Completed, Failed, and Paused states.
- [x] Stream execution messages to a VS Code Output channel and the designer's execution log.
- [ ] Animate edges to show execution flow.
- [ ] Open execution details by clicking an executed node. A details panel class exists but is not wired to node selection.
- [ ] Populate and display all documented details: agent, timing, prompt, context in/out, files modified, tool usage, structured output, logs, and errors.
- [ ] Expose the execution timeline in the UI and make timeline items open node details. Timeline rendering exists but is not wired to a command or view.
- [x] Persist up to 50 completed run records in VS Code extension storage.
- [ ] Provide a UI for viewing previous runs.
- [ ] Inspect workflow state at any point in an execution rather than only the final saved state.
- [ ] Export execution logs through a user-facing command. Export formatting exists only as an internal API.

## File-Based Composition

- [x] Keep workflow definitions in version-controllable `*.workflow.yaml` files.
- [x] List workflow files from `.github/workflows/` in a Workflow Explorer activity-bar view.
- [x] Create a new starter workflow from the **New Workflow** command.
- [ ] Compose or nest reusable workflows.
- [ ] Provide reusable workflow templates or workflow version management.

## Implemented Requirements Discovered During Reconciliation

The following capabilities exist in the current code but do not necessarily satisfy the Version 0.3 architecture requirements:

- [x] Let each Agent node specify a VS Code language-model ID or vendor/model hint.
- [x] Provide a **List Available Models** command that writes installed model IDs and vendors to an output channel.
- [x] A direct, multi-turn Language Model API executor exists as legacy implementation, but it must not be used as a fallback for Copilot Agent nodes.
- [x] The legacy direct executor has workspace tools to create, read, edit, and delete files; list directories; and run shell commands.
- [x] Automatically expose every successful Agent result and success flag to downstream nodes through workflow state.
- [x] Provide a Workflow Explorer activity-bar view for opening `.github/workflows/*.workflow.yaml` files.
- [x] Integrate workflow documents with VS Code backup, revert, and save-as lifecycle operations.

---

# 1. Vision

Create a Visual Studio Code extension that allows developers to visually design, execute, and debug workflows composed of native VS Code custom agents.

The goal is to make AI agent orchestration feel like building a flowchart or state machine while remaining completely inside Visual Studio Code.

Users should never need to leave VS Code to:

* Design workflows
* Connect agents together
* Configure execution logic
* Execute workflows
* Monitor progress
* Debug failures
* Iterate on workflow design

The extension should provide a visual drag-and-drop designer while generating a declarative workflow specification that can be version-controlled in Git.

---

# 2. Product Goals

The system should enable developers to:

* Visually create workflows
* Connect native VS Code agents together
* Pass context between agents
* Execute workflows from inside VS Code
* Support loops and conditional branching
* Support reusable workflows
* Debug workflow execution
* Keep workflows entirely file-based
* Make workflows composable and version controllable

---

# 3. Non-Goals (Version 0)

The initial implementation will NOT include:

* Distributed execution
* Cloud execution
* An explicit agent-runtime provider interface, with GitHub Copilot as the required Version 0 provider
* Additional local or remote agent-runtime providers selected explicitly by workflow configuration
* Multiple machines
* Authentication
* Scheduling
* Workflow marketplace
* Multi-user collaboration
* Workflow analytics
* External orchestration

Everything executes locally inside VS Code.

---

# 4. High-Level Architecture

```text
+-------------------------------------------------------+
|                 Visual Studio Code                    |
|                                                       |
|  +-----------------------------------------------+    |
|  | Workflow Designer UI                          |    |
|  +-----------------------------------------------+    |
|                                                       |
|  +-----------------------------------------------+    |
|  | Workflow Runtime                              |    |
|  +-----------------------------------------------+    |
|                                                       |
|  +-----------------------------------------------+    |
|  | State Manager                                 |    |
|  +-----------------------------------------------+    |
|                                                       |
|               ↓                                       |
|      VS Code Custom Agents                           |
|                                                       |
|  planner.agent.md                                     |
|  implementer.agent.md                                 |
|  tester.agent.md                                      |
|  reviewer.agent.md                                    |
+-------------------------------------------------------+
```

---

# 5. Core Design Principles

## Visual First

Everything should be designed visually.

Users should never manually edit YAML unless they choose to.

---

## Declarative

The workflow definition should be generated automatically.

The visual editor is the source of truth.

---

## Deterministic

The workflow engine determines:

* what executes
* when it executes
* where execution continues

The LLM never controls workflow execution.

---

## File-Based

All workflow definitions should exist as files inside the repository.

Example:

```
.github/workflows/

implement-feature.workflow.yaml

fix-bug.workflow.yaml

seo-audit.workflow.yaml
```

---

# 6. Primary Components

The system consists of two major parts.

## Part 1

Visual Workflow Designer

Responsible for:

* drag & drop editing
* connecting nodes
* editing node properties
* generating workflow configuration

---

## Part 2

Workflow Runtime

Responsible for:

* execution
* state
* loops
* branching
* logging
* progress
* debugging

---

# 7. Visual Workflow Designer

This is the primary user interface.

It should resemble tools such as:

* Node-RED
* n8n
* Unreal Blueprint
* Blender Node Editor
* React Flow

The canvas supports:

* Pan
* Zoom
* Mouse wheel zoom
* Drag selection
* Multi-select
* Copy/Paste
* Delete
* Undo
* Redo

---

# 8. Toolbox

The left panel contains draggable components.

Initially:

## Agent Node

Represents one VS Code custom agent.

Configuration:

* Agent Name
* Prompt
* Description

---

## Condition Node

Evaluates workflow state.

Outputs:

True

False

---

## Start Node

Entry point.

Exactly one required.

---

## End Node

Workflow termination.

Multiple allowed.

---

## Human Approval Node

Execution pauses.

User chooses:

Approve

Reject

---

## Delay Node

Wait before continuing.

---

# 9. Canvas

Users drag components onto the canvas.

Example:

```
Start

↓

Planner

↓

Implementer

↓

Tester

↓

Reviewer

↓

End
```

---

# 10. Connections

Connections are created using the mouse.

Click

↓

Drag

↓

Release

Each edge may contain:

* condition
* label
* priority

Example:

```
Pass

Fail

Retry
```

---

# 11. Node Properties Panel

Selecting a node opens a properties panel.

Agent Node:

Agent:

planner

Prompt:

```
Create a development plan...
```

Timeout:

120 sec

Retries:

2

---

# 12. Generated Workflow

The visual editor generates YAML automatically.

Example:

```yaml
nodes:

- id: planner
  type: vscode-agent
  agent: planner

- id: implement
  type: vscode-agent
  agent: implementer

edges:

- planner -> implement
```

The user never edits this manually unless desired.

---

# 13. Runtime

The runtime executes the graph.

Responsibilities:

* load workflow
* validate
* execute
* maintain state
* evaluate conditions
* route execution

---

# 14. Workflow State

Global state exists for the entire workflow.

Example:

```yaml
state:

iteration: 0

tests_passed: false

approval: false
```

Each node may:

Read state

Write state

---

# 15. Supported Node Types

Version 0

* Start
* End
* VS Code Agent
* Condition
* Human Approval
* Delay

Future

* Parallel
* Merge
* Loop
* For Each
* Switch
* External API
* MCP Tool
* Script
* Shell Command

---

# 16. Execution

Execution always starts from Start.

```
Start

↓

Planner

↓

Implementer

↓

Tester

↓

End
```

---

# 17. Loops

The runtime supports loops.

Example

```
Implement

↓

Test

↓

Pass?

↓

No

↓

Implement
```

Loop exit criteria:

Maximum iterations

Quality score

Boolean condition

Human approval

Timeout

Budget exhausted

---

# 18. Conditions

Example

```
if tests_passed

↓

Reviewer

else

↓

Implementer
```

Conditions evaluate workflow state.

---

# 19. Human Approval

Execution pauses.

UI displays:

Approve

Reject

Workflow resumes.

---

# 20. VS Code Agent Integration

For Version 0, Agent nodes represent native VS Code custom agents and MUST execute as genuine GitHub Copilot subagents.

Example

```
.github/agents/

planner.agent.md

tester.agent.md

reviewer.agent.md
```

The visual Run action MUST submit `@workflow /run` to the extension’s Copilot Chat participant. The participant supplies the valid `toolInvocationToken` required to invoke VS Code’s native `runSubagent` language-model tool.

For each Agent node, the runtime MUST pass the configured agent name through `agentName`. VS Code and GitHub Copilot, rather than the extension, are responsible for loading and applying the selected custom agent’s instructions, tools, hooks, and model configuration. The returned native subagent output becomes the node result and is available to downstream workflow state.

The runtime MUST fail closed with a clear diagnostic if a genuine subagent cannot be started. It MUST NOT silently fall back to a direct Language Model API call, raw prompt execution, or an extension-owned emulation of an agent loop.

The runtime architecture SHOULD evolve toward an agent-runtime provider boundary. GitHub Copilot remains the required and only Version 0 provider; future providers may be added only through an explicit provider interface and MUST preserve provider identity in execution records. A failed Copilot invocation must never be rerouted to another provider implicitly.

---

# 21. Workflow Execution UI

The designer should include a prominent toolbar with the following actions:

* ▶ Run Workflow
* ⏸ Pause Workflow
* ⏹ Stop Workflow
* 🔄 Resume Workflow
* 💾 Save Workflow
* ⚙ Generate Configuration
* ✓ Validate Workflow

For Version 0, "Generate Configuration" and "Run Workflow" are the two primary actions.

---

# 22. Live Execution View

As the workflow executes, the canvas becomes a live status display.

Each node should visually indicate its current state.

States include:

* Waiting
* Running
* Completed
* Failed
* Paused
* Skipped

Suggested visual indicators:

* Gray = Waiting
* Blue = Running
* Green = Completed
* Red = Failed
* Yellow = Paused

Animated edges showing execution flow are a desirable future enhancement.

---

# 23. Debugging

Clicking a node should open an execution details panel.

Display:

* Agent name
* Start time
* End time
* Duration
* Prompt
* Context received
* Context produced
* Files modified
* Tool usage
* Structured output
* Logs
* Errors

The experience should feel similar to stepping through a debugger.

---

# 24. Project Structure

```
.github/

agents/

skills/

prompts/

workflows/
```

Example

```
.github/

agents/

planner.agent.md

implementer.agent.md

tester.agent.md

reviewer.agent.md

workflows/

implement-feature.workflow.yaml
```

---

# 25. Version 0 Implementation Strategy

The objective of Version 0 is **not** to build the complete workflow engine.

The objective is to validate the architecture and user experience as quickly as possible.

## Phase 1 — Visual Designer

Build only the workflow editor.

Required capabilities:

* Custom VS Code panel
* Canvas
* Drag-and-drop node placement
* Node selection
* Node deletion
* Edge creation
* Edge deletion
* Property editor
* Save workflow
* Load workflow
* Generate YAML configuration

No execution yet.

Deliverable:

A complete visual workflow designer capable of producing valid workflow configuration files.

---

## Phase 2 — Basic Runtime

Add execution support.

Initially support only:

* Start
* End
* Agent
* Sequential execution

No conditions.

No loops.

No branching.

Goal:

Verify that VS Code custom agents can be invoked successfully as genuine GitHub Copilot subagents from a token-bearing Copilot Chat participant request, without a direct-model fallback.

---

## Phase 3 — Conditional Execution

Add:

* Condition node
* Workflow state
* Branching
* Variable updates

---

## Phase 4 — Loops

Support:

* Retry loops
* Quality loops
* Maximum iteration limits
* Exit criteria

---

## Phase 5 — Human Interaction

Support:

* Human Approval node
* Pause
* Resume
* Manual intervention

---

## Phase 6 — Debugging

Add:

* Live graph execution
* Execution timeline
* Node logs
* Run history
* State inspection

---

# 26. Future Roadmap

Potential future capabilities include:

* Parallel execution
* Nested workflows
* Reusable workflow templates
* Workflow versioning
* Workflow marketplace
* Execution replay
* Visual diff between workflow versions
* Time-travel debugging
* AI-assisted workflow generation
* AI-assisted workflow optimization
* Automatic workflow validation
* Remote execution
* Cloud execution
* An explicit agent-runtime provider interface, with GitHub Copilot as the required Version 0 provider
* Additional local or remote agent-runtime providers selected explicitly by workflow configuration
* Team collaboration
* MCP-native nodes
* Shell command nodes
* Git operation nodes
* External API nodes

---

# 27. Success Criteria

Version 0 will be considered successful if a user can:

1. Open the Workflow Designer inside VS Code.
2. Drag native VS Code Agent nodes onto a canvas.
3. Connect those nodes visually.
4. Configure node properties.
5. Save the workflow.
6. Reload the workflow.
7. Generate a valid YAML workflow definition from the visual graph.
8. Press **Run Workflow** and execute a simple sequential workflow as genuine GitHub Copilot subagents, without leaving Visual Studio Code or silently falling back to direct model calls.

If these capabilities are achieved, the project has established a solid foundation for a full-featured visual orchestration platform for native VS Code AI agents.
