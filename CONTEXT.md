# Agentic Workflows

Domain model for a VS Code extension that visually designs, executes, and debugs workflows composed of native Copilot subagents.

## Language

**Workflow**:
A directed graph of Nodes and Edges stored as `*.workflow.yaml`. Exactly one Start is required; multiple End nodes are allowed. The Workflow is the unit of execution — the Runtime loads it, validates it, then traverses it from Start to End.
_Avoid_: Pipeline, flow, DAG, orchestration

**Node**:
A single unit of work in a Workflow graph. Each Node has a type (Start, End, Agent, Condition, Human Approval, or Delay), a unique id, a canvas position, and type-specific data. Nodes are the vertices of the graph.
_Avoid_: Step, task, block, component

**Edge**:
A directed connection from one Node to another. Edges define the traversal order. Edges may carry a label (e.g., "Pass", "Fail") but the Runtime determines traversal based on Node behaviour, not Edge priority.
_Avoid_: Connection, link, wire, arrow

**Agent Node**:
A Node that invokes a Copilot subagent (a `.agent.md` file discovered in `.github/agents/`). The Agent Node carries a prompt, model hint, timeout, and retry count. The subagent's output is captured and written to Workflow State.
_Avoid_: Agent step, LLM call, model invocation

**Condition Node**:
A Node that evaluates an expression against Workflow State and routes execution along the True or False outgoing Edge. Nodes on the untaken branch are marked Skipped.
_Avoid_: Branch, decision, gate, if/else

**Human Approval Node**:
A Node that pauses execution and presents Approve/Reject actions to the user. Approval routes along the True Edge; rejection routes along the False Edge.
_Avoid_: Approval gate, manual step, checkpoint

**Workflow State**:
A global key-value bag that persists for the duration of an Execution. Each Node can read and write State. Agent Node outputs are automatically stored under `<node-id>_output` and `<node-id>_success` keys.
_Avoid_: Context, memory, store, variables

**Execution**:
A single run of a Workflow from Start to End. An Execution produces a set of Node Execution Records (one per Node), tracks overall status (Running, Paused, Completed, Failed, Stopped), and may be persisted as a Run History entry.
_Avoid_: Run, traversal, pass

**Node Execution Record**:
An immutable record of a single Node's Execution: status (Waiting, Running, Completed, Failed, Paused, Skipped), start/end times, duration, logs, and errors. Created by the State Manager when the Node is processed.
_Avoid_: Node log, node result, execution log

**Skipped**:
A Node status indicating the Node was not executed because it resides on an untaken branch of a Condition or Human Approval Node. Skipped Nodes still have a Node Execution Record.
_Avoid_: Bypassed, skipped branch, dead path

**Loop**:
A cycle in the Workflow graph where traversal can revisit a previously-executed Node. Loops exit on a boolean Condition, maximum iteration count, quality threshold, Human Approval, timeout, or budget exhaustion.
_Avoid_: Cycle, recursion, iteration

**Runtime**:
The module that loads, validates, and traverses a Workflow graph. The Runtime delegates state management to the State Manager, agent invocation to the Agent Invoker, and condition evaluation to the Condition Evaluator.
_Avoid_: Engine, executor, orchestrator

**State Manager**:
The module that owns Workflow State and Node Execution Records. Exposes a deep interface — `processNode()` wraps a Node's full lifecycle (record creation, timing, status transitions, error capture) in a single call.
_Avoid_: Context manager, execution tracker

**Canvas**:
The visual editing surface where Nodes are placed and Edges are drawn. Supports pan, zoom, grid snapping, and selection. During Execution, the Canvas becomes a live status display.
_Avoid_: Designer, editor, graph view

**Toolbox**:
The left panel containing draggable Node type templates. Users drag from the Toolbox onto the Canvas to add Nodes.
_Avoid_: Palette, component library, node types panel

**Workflow Explorer**:
An activity-bar view that lists `*.workflow.yaml` files from `.github/workflows/` and provides a **New Workflow** command.
_Avoid_: File tree, workflow list

**Outer Loop**:
The human-driven process of articulating business needs, making decisions, and defining requirements that feed into the inner loop (software factory). Outer loop nodes are visual annotations on the Workflow canvas that provide context but are never executed by the Runtime.
_Avoid_: Business workflow, requirement flow, planning phase

**Annotation Node**:
A non-executable Node (Note, Process, or Decision) that provides visual context on the Canvas. Annotation Nodes are serialized to YAML but ignored by the Runtime. They may have Edges pointing to executable Nodes to show relationships.
_Avoid_: Sticky note, comment, label, metadata node

**Note Node**:
An Annotation Node containing free-form text. Used for simple reminders or contextual information. Properties: `text` and optional `description`.
_Avoid_: Comment, sticky, label

**Process Node**:
An Annotation Node describing a business process step — something the business does or completes. Properties: `title` and `description`.
_Avoid_: Business step, task, activity

**Decision Node**:
An Annotation Node marking a human decision point. Rendered as a diamond shape. Properties: `question` and optional `options` (array of strings).
_Avoid_: Choice, fork, branch point

**Project**:
A collection of Workflows viewed and edited together on a single Canvas. Stored as `*.workflow-project.yaml`. Workflows within a Project remain independent execution units. The Project defines spatial layout and membership, not execution order.
_Avoid_: Workspace, collection, suite, bundle
