# Agent Workflow Designer & Runtime

A Visual Studio Code extension that allows developers to visually design, execute, and debug workflows composed of native VS Code custom agents.

## Features

- **Visual Workflow Designer** — Drag-and-drop canvas for building workflows
- **Multiple Node Types** — Start, End, Agent, Condition, Human Approval, Delay
- **Workflow Runtime** — Execute workflows directly from VS Code
- **Conditional Branching** — Route execution based on workflow state
- **Loop Support** — Retry loops with configurable exit criteria
- **Human Approval** — Pause execution for manual review
- **Execution Tracking** — Live status updates on the canvas
- **Run History** — Inspect past executions and state
- **File-Based** — All workflows stored as version-controllable YAML files

## Node Types

| Node | Description |
|------|-------------|
| **Start** | Entry point (exactly one per workflow) |
| **End** | Workflow termination (multiple allowed) |
| **Agent** | Invokes a VS Code custom agent (`.agent.md`) |
| **Condition** | Evaluates an expression against workflow state (True/False branches) |
| **Human Approval** | Pauses execution for user approval/rejection |
| **Delay** | Waits a specified duration before continuing |

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **VS Code** (stable or Insiders)

### Install from Source

```bash
# 1. Install dependencies
npm install

# 2. Full build & install (one command)
rm -rf out && npm run compile && npm run build-webview && rm -f *.vsix && npx vsce package && code --install-extension vscode-workflow-designer-0.1.0.vsix
```

After installing, **reload the VS Code window**:
- `Ctrl+Shift+P` → "Developer: Reload Window" → Enter

### Build Steps (Manual)

| Step | Command | Output |
|------|---------|--------|
| Clean | `rm -rf out` | Removes old build artifacts |
| Compile | `npm run compile` | `src/` → `out/` |
| Build webview | `npm run build-webview` | `webview/src/designer.ts` → `webview/dist/designer.js` |
| Package | `npx vsce package` | `vscode-workflow-designer-0.1.0.vsix` |
| Install | `code --install-extension *.vsix` | Installs extension in VS Code |

## Project Structure

```
.github/
  agents/
    planner.agent.md
    implementer.agent.md
    tester.agent.md
    reviewer.agent.md
  workflows/
    implement-feature.workflow.yaml
    simple-sequence.workflow.yaml
    test-loop.workflow.yaml
```

## Quick Start

1. Open this folder in VS Code
2. Follow the **Installation** steps above
3. Create a new workflow: `Ctrl+Shift+P` → "New Workflow"
4. Or open an existing `.workflow.yaml` file

### 4. Design a Workflow

1. Drag nodes from the **Toolbox** (left panel) onto the canvas
2. Connect nodes by dragging from output ports (right) to input ports (left)
3. Select a node to edit its properties in the **Properties Panel** (right)
4. Press `💾 Save` or `Ctrl+S` to save

### 5. Run a Workflow

1. Open a `.workflow.yaml` file in the designer
2. Click `▶ Run` in the toolbar
3. Watch nodes execute in real-time with color-coded status:
   - 🔵 Blue = Running
   - 🟢 Green = Completed
   - 🔴 Red = Failed
   - 🟡 Yellow = Paused
   - ⚪ Gray = Waiting

## Workflow YAML Format

```yaml
name: my-workflow
description: A sample workflow
nodes:
  - id: start
    type: start
    position:
      x: 100
      y: 100
    data:
      label: Start
  - id: plan
    type: agent
    position:
      x: 100
      y: 200
    data:
      agent: planner
      prompt: Create a development plan
      timeout: 120
      retries: 1
      stateWrites:
        - source: plan
          target: plan_output
  - id: check
    type: condition
    position:
      x: 100
      y: 300
    data:
      expression: state.plan_complete === true
  - id: end
    type: end
    position:
      x: 100
      y: 400
    data:
      label: Done
edges:
  - source: start
    target: plan
  - source: plan
    target: check
  - source: check
    target: end
    label: True
```

## Agent Files

Agents are defined as Markdown files in `.github/agents/`:

```markdown
---
name: planner
description: Creates development plans
---

You are a planning agent. Given a task, create a detailed plan.

## Instructions
1. Analyze the request
2. Break into tasks
3. Output a structured plan
```

## Workflow State

Workflows maintain a global state that nodes can read and write:

- **Agent nodes** write state via `stateWrites` mappings
- **Condition nodes** read state via expressions like `state.tests_passed === true`
- **Human Approval** results are stored in state automatically

## Commands

| Command | Description |
|---------|-------------|
| `New Workflow` | Create a new workflow file |
| `▶ Run Workflow` | Execute the current workflow |
| `⏸ Pause Workflow` | Pause execution |
| `⏹ Stop Workflow` | Stop execution immediately |
| `🔄 Resume Workflow` | Resume paused execution |
| `💾 Save Workflow` | Save current workflow |
| `✓ Validate Workflow` | Validate workflow structure |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Delete` / `Backspace` | Delete selected nodes |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save |
| `Shift+Click` | Multi-select nodes |
| `Escape` | Cancel edge creation / Clear selection |

## Development

```bash
# Install dependencies
npm install

# Full build & install
rm -rf out && npm run compile && npm run build-webview && npx vsce package && code --install-extension *.vsix

# Watch for TypeScript changes (extension code only)
npm run watch

# Rebuild webview after changing webview/src/ files
npm run build-webview

# Test webview in browser (no VS Code needed)
npm run build-webview
# Then open webview/test.html in your browser

# Lint
npm run lint
```

> **Note:** After any build & install, always reload the VS Code window (`Ctrl+Shift+P` → "Developer: Reload Window").

## Architecture

```
┌─────────────────────────────────────────┐
│           VS Code Extension             │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Workflow Designer (Webview)      │  │
│  │  - Canvas (Canvas API)            │  │
│  │  - Toolbox (Drag & Drop)          │  │
│  │  - Properties Panel               │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Workflow Runtime                 │  │
│  │  - Execution Engine               │  │
│  │  - State Manager                  │  │
│  │  - Condition Evaluator            │  │
│  │  - Agent Invoker                  │  │
│  │  - Run History                    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Models & Utilities               │  │
│  │  - Workflow Types                 │  │
│  │  - YAML Serializer                │  │
│  │  - Workflow Validator             │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 0 | ✅ | Project scaffolding |
| 1 | ✅ | Visual workflow designer |
| 2 | ✅ | Basic sequential runtime |
| 3 | ✅ | Conditional execution |
| 4 | ✅ | Loop support |
| 5 | ✅ | Human interaction |
| 6 | ✅ | Debugging & observability |

## License

MIT
