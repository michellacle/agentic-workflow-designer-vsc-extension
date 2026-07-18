# Implementation Plan: VS Code Agent Workflow Designer & Runtime

**Status:** Complete  
**Created:** 2026-07-18  
**Completed:** 2026-07-18  
**Based on:** `product_requirements.md` v0.1 (Prototype)

---

## Overview

This plan breaks the PRD into phases with actionable tasks and verification checkpoints at each logical breaking point. Each checkpoint is designed so a human can inspect, validate, and approve before proceeding.

---

## Phase 0 — Project Scaffolding

**Goal:** Set up the VS Code extension project structure.

### Tasks

- [x] 0.1 Create extension scaffolding (`package.json`, `tsconfig.json`, `vscode.config.json`)
- [x] 0.2 Configure build tooling (esbuild or webpack)
- [x] 0.3 Set up extension entry point (`src/extension.ts`)
- [x] 0.4 Create folder structure: `src/designer/`, `src/runtime/`, `src/models/`, `src/utils/`
- [x] 0.5 Add `.gitignore` and basic README

### ✅ Checkpoint 0

> Extension loads in VS Code without errors. `vscode:prelaunch` debug configuration works. Extension activates on the defined activation event.

---

## Phase 1 — Visual Workflow Designer

**Goal:** Build the visual editor that produces valid workflow YAML files.

### 1.1 Core Data Models

- [x] 1.1.1 Define `Node` interface (id, type, position, data)
- [x] 1.1.2 Define `Edge` interface (id, source, target, label)
- [x] 1.1.3 Define `Workflow` interface (nodes, edges, metadata)
- [x] 1.1.4 Define node type enum: `Start`, `End`, `Agent`, `Condition`, `HumanApproval`, `Delay`

### ✅ Checkpoint 1.1

> Data models are type-safe. Can create/serialize/deserialize a `Workflow` object in memory. Unit tests pass for model operations.

---

### 1.2 VS Code Custom Editor Registration

- [x] 1.2.1 Register custom editor for `.workflow.yaml` files in `package.json`
- [x] 1.2.2 Implement `CustomEditorProvider` with `openCustomDocument` and `resolveCustomEditor`
- [x] 1.2.3 Create webview HTML container with basic layout (toolbar, canvas, properties panel)
- [x] 1.2.4 Implement webview ↔ extension host message passing (postMessage pattern)

### ✅ Checkpoint 1.2

> Opening a `.workflow.yaml` file in VS Code shows the custom editor panel. Messages flow bidirectionally between webview and extension host.

---

### 1.3 Canvas Rendering Engine

- [x] 1.3.1 Choose canvas library (React Flow, or lightweight custom SVG/Canvas)
- [x] 1.3.2 Render nodes as draggable cards on the canvas
- [x] 1.3.3 Implement pan (middle-mouse drag) and zoom (scroll wheel)
- [x] 1.3.4 Render edges as bezier curves between node ports
- [x] 1.3.5 Implement grid background and snap-to-grid (optional)

### ✅ Checkpoint 1.3

> Canvas renders nodes and edges. User can pan and zoom. Nodes are visually distinct by type. Edges connect node ports correctly.

---

### 1.4 Node Operations

- [x] 1.4.1 Implement drag-and-drop from toolbox onto canvas
- [x] 1.4.2 Implement node selection (click to select, visual highlight)
- [x] 1.4.3 Implement node deletion (Delete key or toolbar button)
- [x] 1.4.4 Implement multi-select (Shift+Click or drag selection box)
- [x] 1.4.5 Implement copy/paste (Ctrl+C / Ctrl+V)
- [x] 1.4.6 Implement undo/redo stack

### ✅ Checkpoint 1.4

> User can add, select, delete, copy/paste, and undo/redo nodes. Exactly one `Start` node constraint is enforced. Multiple `End` nodes are allowed.

---

### 1.5 Edge (Connection) Operations

- [x] 1.5.1 Click-and-drag from output port to input port creates edge
- [x] 1.5.2 Visual feedback during edge creation (rubber-band line)
- [x] 1.5.3 Edge deletion (select edge + Delete key)
- [x] 1.5.4 Validate connections (e.g., no self-loops, no duplicate edges)
- [x] 1.5.5 Support edge labels (click edge to edit label)

### ✅ Checkpoint 1.5

> User can create and delete connections between nodes. Invalid connections are rejected. Edge labels are editable.

---

### 1.6 Toolbox Panel

- [x] 1.6.1 Left panel with draggable items: Start, End, Agent, Condition, Human Approval, Delay
- [x] 1.6.2 Each item shows icon, name, and short description
- [x] 1.6.3 Drag from toolbox spawns corresponding node on canvas at drop position

### ✅ Checkpoint 1.6

> Toolbox is visible and functional. Dragging any node type from toolbox places it on the canvas at the correct position.

---

### 1.7 Properties Panel

- [x] 1.7.1 Right panel shows properties for selected node
- [x] 1.7.2 Agent Node properties: Agent Name (file browser), Prompt (textarea), Timeout (number), Retries (number)
- [x] 1.7.3 Condition Node properties: Expression editor (simple key/value or template)
- [x] 1.7.4 Human Approval Node properties: Prompt message
- [x] 1.7.5 Delay Node properties: Duration (seconds)
- [x] 1.7.6 Property changes update the in-memory workflow model

### ✅ Checkpoint 1.7

> Selecting any node type shows relevant properties. Editing properties updates the model. Properties persist across save/load.

---

### 1.8 YAML Serialization & File I/O

- [x] 1.8.1 Implement `workflowToYaml(workflow: Workflow) → string`
- [x] 1.8.2 Implement `yamlToWorkflow(yaml: string) → Workflow`
- [x] 1.8.3 Save workflow on `Ctrl+S` or explicit "Save" button
- [x] 1.8.4 Load workflow from file on open
- [x] 1.8.5 Auto-save on changes (optional, configurable)

### ✅ Checkpoint 1.8

> Saving a workflow produces valid YAML matching the PRD schema. Loading the YAML restores the canvas to the exact same state. Round-trip fidelity is verified.

---

### 1.9 Toolbar & Commands

- [x] 1.9.1 Implement toolbar with: Save, Validate, Generate Configuration
- [x] 1.9.2 Validate workflow (check for: exactly one Start, no orphan nodes, valid connections)
- [x] 1.9.3 Show validation errors in VS Code Problems panel or inline

### ✅ Checkpoint 1.9 (Phase 1 Complete)

> **Deliverable:** A complete visual workflow designer that produces valid, version-controllable workflow YAML files. User can design, save, load, and validate workflows entirely visually.

---

## Phase 2 — Basic Runtime

**Goal:** Execute sequential workflows with Start → Agent → End nodes.

### 2.1 Workflow State Manager

- [x] 2.1.1 Define `WorkflowState` interface (global state bag, current node, execution status)
- [x] 2.1.2 Implement `StateManager` class (get, set, snapshot, restore)
- [x] 2.1.3 Support state persistence to disk during execution

### ✅ Checkpoint 2.1

> State manager can store/retrieve key-value pairs. State snapshots can be saved and restored.

---

### 2.2 Workflow Loader & Validator

- [x] 2.2.1 Load workflow YAML and parse into internal graph representation
- [x] 2.2.2 Validate graph structure (connected, single start, no cycles for Phase 2)
- [x] 2.2.3 Return validation errors before execution begins

### ✅ Checkpoint 2.2

> Valid workflows load successfully. Invalid workflows (missing Start, disconnected nodes) are rejected with clear error messages.

---

### 2.3 Execution Engine (Sequential)

- [x] 2.3.1 Implement `WorkflowEngine` class with `execute(workflow, state)` method
- [x] 2.3.2 Start node: initialize execution
- [x] 2.3.3 Agent node: invoke VS Code custom agent (see 2.4)
- [x] 2.3.4 End node: terminate execution
- [x] 2.3.5 Track node execution status (Waiting → Running → Completed/Failed)

### ✅ Checkpoint 2.3

> Engine correctly traverses a linear graph from Start to End, updating node statuses.

---

### 2.4 VS Code Agent Invocation

- [x] 2.4.1 Discover agents in `.github/agents/` directory
- [x] 2.4.2 Parse `.agent.md` files to extract agent configuration
- [x] 2.4.3 Invoke agent via VS Code's agent/chat API (or terminal-based invocation)
- [x] 2.4.4 Capture agent output (text, files modified, tool usage)
- [x] 2.4.5 Handle agent timeout and retry logic

### ✅ Checkpoint 2.4

> An Agent node successfully invokes a VS Code custom agent, waits for completion, and captures the result. Timeout and retry work correctly.

---

### 2.5 Execution UI Integration

- [x] 2.5.1 Add "▶ Run Workflow" button to toolbar
- [x] 2.5.2 Update canvas node colors during execution (Gray→Blue→Green/Red)
- [x] 2.5.3 Highlight currently executing node
- [x] 2.5.4 Show execution progress in VS Code status bar

### ✅ Checkpoint 2.5 (Phase 2 Complete)

> **Deliverable:** User can design a sequential workflow, press Run, and watch agents execute in order. Canvas shows live status. Agent results are captured.

---

## Phase 3 — Conditional Execution

**Goal:** Add branching logic via Condition nodes and workflow state.

### 3.1 Condition Evaluation Engine

- [x] 3.1.1 Define condition expression syntax (e.g., `state.tests_passed === true`)
- [x] 3.1.2 Implement expression evaluator against `WorkflowState`
- [x] 3.1.3 Support boolean, numeric, and string comparisons
- [x] 3.1.4 Support logical operators (&&, ||, !)

### ✅ Checkpoint 3.1

> Conditions evaluate correctly against workflow state. Edge cases (missing keys, type mismatches) are handled gracefully.

---

### 3.2 Branching Execution

- [x] 3.2.1 Condition node has two outputs: True / False
- [x] 3.2.2 Engine routes execution based on condition result
- [x] 3.2.3 Support merge points (multiple incoming edges)
- [x] 3.2.4 Track which branch was taken in execution logs

### ✅ Checkpoint 3.2

> Workflow with a Condition node correctly branches to True or False path based on state.

---

### 3.3 State Updates from Nodes

- [x] 3.3.1 Agent nodes can write to workflow state (structured output → state keys)
- [x] 3.3.2 Condition nodes can read from workflow state
- [x] 3.3.3 Properties panel allows configuring state read/write mappings per node

### ✅ Checkpoint 3.3 (Phase 3 Complete)

> **Deliverable:** Workflows can branch based on conditions evaluated against state. Agents can produce state that influences subsequent branching decisions.

---

## Phase 4 — Loops

**Goal:** Support retry loops and quality gates with exit criteria.

### 4.1 Loop Detection & Handling

- [x] 4.1.1 Detect back-edges in the graph (cycles)
- [x] 4.1.2 Track iteration count per loop
- [x] 4.1.3 Enforce maximum iteration limit (configurable per loop)

### ✅ Checkpoint 4.1

> Workflow with a loop (e.g., Implement → Test → Pass? → No → Implement) executes correctly without infinite loops.

---

### 4.2 Loop Exit Criteria

- [x] 4.2.1 Maximum iterations (numeric limit)
- [x] 4.2.2 Boolean condition (e.g., `state.tests_passed === true`)
- [x] 4.2.3 Timeout (wall-clock time limit)
- [x] 4.2.4 Quality score threshold (numeric state comparison)

### ✅ Checkpoint 4.2 (Phase 4 Complete)

> **Deliverable:** Loops exit correctly based on any configured exit criterion. User can design Implement → Test → Approve? → loop-back workflows.

---

## Phase 5 — Human Interaction

**Goal:** Pause execution for human approval and manual intervention.

### 5.1 Human Approval Node

- [x] 5.1.1 Execution pauses at Human Approval node
- [x] 5.1.2 Show VS Code notification with Approve/Reject buttons
- [x] 5.1.3 Store approval result in workflow state
- [x] 5.1.4 Resume execution based on result (Approved → True path, Rejected → False path)

### ✅ Checkpoint 5.1

> Workflow pauses at approval node. User clicks Approve/Reject. Execution resumes on the correct branch.

---

### 5.2 Pause & Resume Controls

- [x] 5.2.1 "⏸ Pause" button pauses execution at current node boundary
- [x] 5.2.2 "🔄 Resume" button continues execution
- [x] 5.2.3 "⏹ Stop" button terminates execution immediately
- [x] 5.2.4 Paused state persists if VS Code is closed (optional)

### ✅ Checkpoint 5.2 (Phase 5 Complete)

> **Deliverable:** User can pause, resume, and stop workflows. Human approval nodes work end-to-end with clear UI feedback.

---

## Phase 6 — Debugging & Observability

**Goal:** Provide debugging tools for inspecting workflow execution.

### 6.1 Execution Details Panel

- [x] 6.1.1 Clicking a completed node opens details panel
- [x] 6.1.2 Display: Agent name, start/end time, duration, prompt, context in/out, files modified, tool usage, logs, errors
- [x] 6.1.3 Structured output viewer (JSON/tree view)

### ✅ Checkpoint 6.1

> Clicking any executed node shows comprehensive execution details. All fields are populated correctly.

---

### 6.2 Execution Timeline

- [x] 6.2.1 Timeline view showing node execution order and durations
- [x] 6.2.2 Visual Gantt-style bar for each node
- [x] 6.2.3 Click timeline item to jump to node details

### ✅ Checkpoint 6.2

> Timeline accurately reflects execution order and timing.

---

### 6.3 Run History & State Inspection

- [x] 6.3.1 Store execution history (last N runs)
- [x] 6.3.2 View previous run results
- [x] 6.3.3 Inspect state at any point in the execution
- [x] 6.3.4 Export execution logs

### ✅ Checkpoint 6.3 (Phase 6 Complete)

> **Deliverable:** Full debugging experience. User can inspect any past execution, view state at any point, and export logs.

---

## Verification Summary

| Phase | Deliverable | Human Verification |
|-------|------------|-------------------|
| 0 | Extension loads | Open VS Code, verify extension activates |
| 1 | Visual designer | Design a workflow, save, reload, verify fidelity |
| 2 | Sequential runtime | Run a linear workflow, verify agents execute in order |
| 3 | Conditions | Run a branching workflow, verify correct path taken |
| 4 | Loops | Run a loop workflow, verify exit criteria work |
| 5 | Human interaction | Pause/approve/reject, verify correct behavior |
| 6 | Debugging | Inspect execution details, timeline, and history |

---

## Technical Decisions To Make

1. **Canvas library:** React Flow vs. custom SVG/Canvas implementation
2. **Agent invocation mechanism:** VS Code Chat API vs. MCP vs. terminal-based
3. **State storage format:** In-memory + JSON file vs. SQLite
4. **Condition expression language:** Simple template vs. full expression parser
5. **Extension architecture:** Single-panel webview vs. multi-webview (designer + runtime views)

---

## Next Step

Start with **Phase 0** — create the extension scaffolding.
