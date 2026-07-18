# Product Requirements Document (PRD)

# VS Code Agent Workflow Designer & Runtime

**Version:** 0.1 (Prototype)

**Status:** Draft

**Author:** OpenAI

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

Nodes represent native VS Code custom agents.

Example

```
.github/agents/

planner.agent.md

tester.agent.md

reviewer.agent.md
```

The runtime launches those agents.

It does not execute raw LLM prompts.

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

Verify that VS Code custom agents can be invoked successfully from the runtime.

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
8. Press **Run Workflow** and execute a simple sequential workflow composed of VS Code custom agents without leaving Visual Studio Code.

If these capabilities are achieved, the project has established a solid foundation for a full-featured visual orchestration platform for native VS Code AI agents.
