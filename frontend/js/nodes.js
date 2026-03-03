// =====================================================
// ASL Editor — Node Definitions
// =====================================================

import { state } from './state.js';
import {
    DEFAULT_TOOL_MAX_ITERATIONS,
    DEFAULT_TOOL_LIMIT_WARNING,
    NODE_TYPE_MAP,
    ASL_DEBUG
} from './constants.js';
import { showToast, randomCanvasPosition, updateSummary, syncRouterValues } from './utils.js';
import { renderInspector } from './inspector.js';

// ---------------------- Entry Point Node ----------------------

function EntryPointNode() {
    this.title = "Entry Node";
    this.color = "#334155";
    this.bgcolor = "#1E293B";
    this.resizable = false;
    this.properties = {
        title: "Entry Node",
        initial_state: {}
    };
    this.addOutput("next", "flow");
    this.widgets_up = true;
    this.serialize_widgets = true;

    this.onAdded = function () {
        this.size = [200, 30];
    };

    this.onDrawForeground = function (ctx) {
        ctx.fillStyle = "#3B82F6";
        ctx.fillRect(0, 0, this.size[0], 3);
    };

    this.onOutputClick = function (slot_index) {
        if (ASL_DEBUG) console.log("Entry Node output clicked:", slot_index);
    };
}
EntryPointNode.title = "Entry Node";
EntryPointNode.title_color = "#000000";

// ---------------------- LLM Node ----------------------

function LLMNode() {
    this.title = "LLM Node";
    this.color = "#334155";
    this.bgcolor = "#1E293B";
    this.properties = {
        title: "LLM Node",
        output_key: "llm_output",
        input_state_keys: [],
        output_state_keys: [],
        system_prompt: "",
        human_prompt: "",
        structured_output_enabled: true,
        structured_output_schema: [],
        selected_tools: [],
        max_tool_iterations: DEFAULT_TOOL_MAX_ITERATIONS,
        iteration_warning_message: DEFAULT_TOOL_LIMIT_WARNING
    };
    this.addInput("in", "flow");
    this.addOutput("out", "flow");
    this.widgets_up = true;
    this.serialize_widgets = true;

    this.onConnectionsChange = function (type, slot, isConnected) {
        if (type !== LiteGraph.INPUT) return;
        const self = this;
        if (isConnected) {
            const hasEmptySlot = this.inputs.some(inp => !inp.link);
            if (!hasEmptySlot) {
                this.addInput(`in${this.inputs.length + 1}`, "flow");
            }
        } else {
            while (this.inputs.length > 1 && !this.inputs[this.inputs.length - 1].link) {
                this.removeInput(this.inputs.length - 1);
            }
        }
        setTimeout(() => {
            self._recalcSize();
            if (state.graph) state.graph.setDirtyCanvas(true, true);
        }, 0);
    };

    const getToolsStartY = () => {
        const slotHeight = LiteGraph.NODE_SLOT_HEIGHT || 20;
        const numRows = Math.max(
            this.inputs ? this.inputs.length : 1,
            this.outputs ? this.outputs.length : 0
        );
        return numRows * slotHeight + 8;
    };

    this._recalcSize = () => {
        const tools = this.properties.selected_tools || [];
        const n = tools.length;
        const startY = getToolsStartY();
        if (n === 0) {
            this.size[1] = Math.max(30, startY + 10);
        } else {
            this.size[1] = Math.max(60, startY + 18 + n * 14 + 10);
        }
    };

    const renderSelectedTools = (ctx) => {
        const tools = this.properties.selected_tools || [];
        if (tools.length === 0) return;

        ctx.save();
        ctx.font = "11px 'Inter', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const maxWidth = this.size[0] - 24;
        const lineHeight = 14;
        let y = getToolsStartY();

        ctx.fillStyle = "#64748B";
        ctx.fillText("🔧 tools", 8, y);
        y += 18;

        ctx.fillStyle = "#94A3B8";
        tools.forEach((tool) => {
            let label = tool;
            if (ctx.measureText(label).width > maxWidth) {
                while (label.length > 1 && ctx.measureText(label + "…").width > maxWidth) {
                    label = label.slice(0, -1);
                }
                label += "…";
            }
            ctx.fillText(label, 8, y);
            y += lineHeight;
        });

        ctx.restore();
    };

    this.onDrawForeground = function (ctx) {
        ctx.fillStyle = "#F59E0B";
        ctx.fillRect(0, 0, this.size[0], 3);
        renderSelectedTools(ctx);
    };

    this.onAdded = function () {
        this.size = [200, 30];
    };

    this.computeSize = function () {
        return this.size;
    };

    this.onConfigure = function () {
        this._recalcSize();
    };

    this._addTool = (toolName) => {
        this.properties.selected_tools = this.properties.selected_tools || [];
        if (this.properties.selected_tools.includes(toolName)) {
            showToast(`Tool "${toolName}" already added`, "info");
            return true;
        }
        if (!state.globalTools[toolName]) {
            showToast(`Tool "${toolName}" is not defined`, "error");
            return false;
        }
        this.properties.selected_tools.push(toolName);
        this._recalcSize();
        state.graph.setDirtyCanvas(true, true);
        if (state.canvas.selected_nodes && state.canvas.selected_nodes[this.id]) {
            renderInspector(this);
        }
        showToast(`Added tool "${toolName}"`, "success");
        return true;
    };

    this.onDropItem = function (event) {
        const toolName = event?.dataTransfer?.getData("tool-name");
        if (!toolName) return false;
        return this._addTool(toolName);
    };
}
LLMNode.title = "LLM Node";
LLMNode.title_color = "#000000";

// ---------------------- Router Block Node ----------------------

function RouterBlockNode() {
    this.title = "Router Block";
    this.color = "#334155";
    this.bgcolor = "#1E293B";
    this.properties = {
        title: "Router Block",
        input_state_keys: [],
        router_values: [],
        system_prompt: ""
    };
    this.addInput("in", "flow");
    this.addOutput("out", "flow");
    this.widgets_up = true;
    this.serialize_widgets = true;

    this.onConnectionsChange = function (type) {
        if (type === LiteGraph.OUTPUT) {
            syncRouterValues(this);
            if (state.canvas && state.canvas.selected_nodes && state.canvas.selected_nodes[this.id]) {
                renderInspector(this);
            }
        }
    };

    this.onAdded = function () {
        this.size = [200, 30];
    };

    this.onDrawForeground = function (ctx) {
        ctx.fillStyle = "#A855F7";
        ctx.fillRect(0, 0, this.size[0], 3);
    };
}
RouterBlockNode.title = "Router Block";
RouterBlockNode.title_color = "#000000";

// ---------------------- Worker Node ----------------------

function WorkerNode() {
    this.title = "Worker Node";
    this.color = "#334155";
    this.bgcolor = "#1E293B";
    this.properties = {
        title: "Worker Node",
        description: "Performs specialized analysis and processing tasks delegated by the orchestrator",
        system_prompt: "",
        structured_output_enabled: true,
        structured_output_schema: [],
        selected_tools: [],
        max_tool_iterations: DEFAULT_TOOL_MAX_ITERATIONS,
        iteration_warning_message: DEFAULT_TOOL_LIMIT_WARNING
    };
    this.addInput("in", "flow");
    this.widgets_up = true;
    this.serialize_widgets = true;

    const getToolsStartY = () => {
        const slotHeight = LiteGraph.NODE_SLOT_HEIGHT || 20;
        const numRows = Math.max(
            this.inputs ? this.inputs.length : 1,
            this.outputs ? this.outputs.length : 0
        );
        return numRows * slotHeight + 8;
    };

    this._recalcSize = () => {
        const tools = this.properties.selected_tools || [];
        const n = tools.length;
        if (n === 0) {
            this.size[1] = 30;
            return;
        }
        const startY = getToolsStartY();
        this.size[1] = Math.max(60, startY + 18 + n * 14 + 10);
    };

    const renderSelectedTools = (ctx) => {
        const tools = this.properties.selected_tools || [];
        if (tools.length === 0) return;

        ctx.save();
        ctx.font = "11px 'Inter', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const maxWidth = this.size[0] - 24;
        const lineHeight = 14;
        let y = getToolsStartY();

        ctx.fillStyle = "#64748B";
        ctx.fillText("🔧 tools", 8, y);
        y += 18;

        ctx.fillStyle = "#94A3B8";
        tools.forEach((tool) => {
            let label = tool;
            if (ctx.measureText(label).width > maxWidth) {
                while (label.length > 1 && ctx.measureText(label + "…").width > maxWidth) {
                    label = label.slice(0, -1);
                }
                label += "…";
            }
            ctx.fillText(label, 8, y);
            y += lineHeight;
        });

        ctx.restore();
    };

    this.onDrawForeground = function (ctx) {
        ctx.fillStyle = "#10B981";
        ctx.fillRect(0, 0, this.size[0], 3);
        renderSelectedTools(ctx);
    };

    this.onAdded = function () {
        this.size = [200, 30];
    };

    this.computeSize = function () {
        return this.size;
    };

    this.onConfigure = function () {
        this._recalcSize();
    };

    this._addTool = (toolName) => {
        this.properties.selected_tools = this.properties.selected_tools || [];
        if (this.properties.selected_tools.includes(toolName)) {
            showToast(`Tool "${toolName}" already added`, "info");
            return true;
        }
        if (!state.globalTools[toolName]) {
            showToast(`Tool "${toolName}" is not defined`, "error");
            return false;
        }
        this.properties.selected_tools.push(toolName);
        this._recalcSize();
        state.graph.setDirtyCanvas(true, true);
        if (state.canvas.selected_nodes && state.canvas.selected_nodes[this.id]) {
            renderInspector(this);
        }
        showToast(`Added tool "${toolName}"`, "success");
        return true;
    };

    this.onDropItem = function (event) {
        const toolName = event?.dataTransfer?.getData("tool-name");
        if (!toolName) return false;
        return this._addTool(toolName);
    };
}
WorkerNode.title = "Worker Node";
WorkerNode.title_color = "#000000";

// ---------------------- Registration ----------------------

export function registerNodeTypes() {
    LiteGraph.registerNodeType("asl/entry", EntryPointNode);
    LiteGraph.registerNodeType("asl/llm", LLMNode);
    LiteGraph.registerNodeType("asl/router", RouterBlockNode);
    LiteGraph.registerNodeType("asl/worker", WorkerNode);
}

// ---------------------- Node Helpers ----------------------

export function normalizeNodeProperties(node) {
    node.properties = node.properties || {};

    if (node.type === "asl/entry") {
        delete node.properties.system_prompt;
    }

    if (node.type === "asl/llm") {
        delete node.properties.model;
        delete node.properties.temperature;
        delete node.properties.tools;
        node.properties.output_key = node.properties.output_key || "llm_output";
        if (typeof node.properties.system_prompt !== "string") node.properties.system_prompt = "";
        if (typeof node.properties.human_prompt !== "string") node.properties.human_prompt = "";
        if (typeof node.properties.structured_output_enabled !== "boolean") node.properties.structured_output_enabled = true;
        if (!node.properties.structured_output_schema) node.properties.structured_output_schema = [];
        if (!Array.isArray(node.properties.selected_tools)) node.properties.selected_tools = [];
        if (node.properties.selected_tools.length > 0) {
            const limit = Number(node.properties.max_tool_iterations);
            if (!Number.isFinite(limit) || limit <= 0) {
                node.properties.max_tool_iterations = DEFAULT_TOOL_MAX_ITERATIONS;
            } else {
                node.properties.max_tool_iterations = Math.trunc(limit);
            }
            if (typeof node.properties.iteration_warning_message !== "string" || !node.properties.iteration_warning_message.trim()) {
                node.properties.iteration_warning_message = DEFAULT_TOOL_LIMIT_WARNING;
            }
        }
    }

    if (node.type === "asl/worker") {
        delete node.properties.model;
        delete node.properties.temperature;
        delete node.properties.tools;
        delete node.properties.structured_output_schema;
        delete node.properties.structured_output_enabled;
        if (typeof node.properties.system_prompt !== "string") node.properties.system_prompt = "";
        if (!Array.isArray(node.properties.selected_tools)) node.properties.selected_tools = [];
        if (node.properties.selected_tools.length > 0) {
            const limit = Number(node.properties.max_tool_iterations);
            if (!Number.isFinite(limit) || limit <= 0) {
                node.properties.max_tool_iterations = DEFAULT_TOOL_MAX_ITERATIONS;
            } else {
                node.properties.max_tool_iterations = Math.trunc(limit);
            }
            if (typeof node.properties.iteration_warning_message !== "string" || !node.properties.iteration_warning_message.trim()) {
                node.properties.iteration_warning_message = DEFAULT_TOOL_LIMIT_WARNING;
            }
        }
    }

    if (node.properties.title) {
        node.title = node.properties.title;
    }
}

export function ensureSingleEntry(node) {
    if (node.type !== "asl/entry") return true;
    const existing = state.graph._nodes.find((n) => n !== node && n.type === "asl/entry");
    if (existing) {
        showToast("Only one Entry Point is allowed.", "warning");
        state.graph.remove(node);
        return false;
    }
    state.appState.entrypointId = node.id;
    return true;
}

export function createNode(kind, pos) {
    const type = NODE_TYPE_MAP[kind];
    if (!type) return;

    const node = LiteGraph.createNode(type);
    if (!node) return;

    node.pos = pos || randomCanvasPosition();
    state.graph.add(node);
    ensureSingleEntry(node);
    state.canvas.selectNode(node);
    updateSummary();
}
