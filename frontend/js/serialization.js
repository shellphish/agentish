// =====================================================
// ASL Editor — Serialization (ASL ↔ Graph)
// =====================================================

import { state } from './state.js';
import { NODE_FORM_KEYS, EXPORT_TYPE_MAP, IMPORT_TYPE_MAP } from './constants.js';
import {
    showToast,
    downloadFile,
    normalizeSchemaToLowercase,
    renderStateSchemaDisplay,
    updateSummary,
    randomCanvasPosition
} from './utils.js';
import { normalizeNodeProperties } from './nodes.js';
import { renderToolList, renderFunctionCatalog } from './tools.js';

// ---------------------- Edge Collection ----------------------

function collectEdges(serializedGraph) {
    const edges = [];
    (serializedGraph.nodes || []).forEach((node) => {
        if (!node.outputs) return;
        node.outputs.forEach((output) => {
            if (!output.links) return;
            output.links.forEach((linkId) => {
                const link =
                    serializedGraph.links.find((l) => l.id === linkId) ||
                    state.graph.links[linkId];
                if (!link) return;
                const edge = {
                    from: String(node.id),
                    to: String(link.target_id),
                    target_slot: link.target_slot,
                    type: node.type === "asl/router" ? "ConditionalEdge" : "NormalEdge"
                };
                if (edge.type === "ConditionalEdge") {
                    edge.condition = output.name || "default";
                }
                edges.push(edge);
            });
        });
    });
    return edges;
}

// ---------------------- ASL Export ----------------------

export function serializeToASL() {
    const serializedGraph = state.graph.serialize();
    const nodes = serializedGraph.nodes || [];
    const edges = collectEdges(serializedGraph);

    const entryNode = nodes.find((node) => node.type === "asl/entry");
    if (!entryNode) {
        throw new Error("Graph requires an Entry Point node.");
    }

    const aslNodes = nodes.map((node) => {
        const exportedType = EXPORT_TYPE_MAP[node.type] || "CustomNode";
        const props = node.properties || {};
        const allowedKeys = NODE_FORM_KEYS[node.type];
        let config;

        if (allowedKeys) {
            config = {};
            allowedKeys.forEach((key) => {
                if (props[key] !== undefined) {
                    config[key] = JSON.parse(JSON.stringify(props[key]));
                }
            });
        } else {
            config = JSON.parse(JSON.stringify(props));
        }
        return {
            id: String(node.id),
            type: exportedType,
            label: node.title || exportedType,
            config
        };
    });

    return {
        meta: {
            version: "2025.10",
            exported_at: new Date().toISOString()
        },
        graph: {
            version: 2,
            entrypoint: String(entryNode.id),
            state: { schema: state.appState.schema },
            nodes: aslNodes,
            edges,
            tools: state.globalTools
        }
    };
}

// ---------------------- ASL Import ----------------------

export function configureFromASL(asl) {
    state.graph.clear();
    const { graph: graphData } = asl;

    state.appState.schema = normalizeSchemaToLowercase(graphData?.state?.schema || {});
    state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
    renderStateSchemaDisplay();
    state.appState.entrypointId = null;

    // Load tools
    state.globalTools = graphData?.tools || {};
    renderToolList();
    renderFunctionCatalog();

    const idMap = new Map();
    (graphData.nodes || []).forEach((nodeInfo) => {
        const type = IMPORT_TYPE_MAP[nodeInfo.type] || "asl/transform";
        const node = LiteGraph.createNode(type);
        if (!node) return;
        node.pos = randomCanvasPosition();
        node.properties = { ...node.properties, ...(nodeInfo.config || {}) };
        normalizeNodeProperties(node);
        if (nodeInfo.label) {
            node.title = nodeInfo.label;
            node.properties.title = nodeInfo.label;
        }
        state.graph.add(node);
        idMap.set(String(nodeInfo.id), node);
        if (node.type === "asl/entry") {
            state.appState.entrypointId = node.id;
        }
    });

    // Pre-expand input slots for LLM nodes
    (graphData.edges || []).forEach((edge) => {
        if (edge.implicit) return;
        const toNode = idMap.get(String(edge.to));
        if (toNode && toNode.type === "asl/llm" && edge.target_slot !== undefined) {
            const requiredSlots = edge.target_slot + 1;
            while (toNode.inputs.length < requiredSlots) {
                const newSlotIndex = toNode.inputs.length;
                const slotName = newSlotIndex === 0 ? "in" : `in${newSlotIndex + 1}`;
                toNode.addInput(slotName, "flow");
            }
        }
    });

    // Create connections
    (graphData.edges || []).forEach((edge) => {
        if (edge.implicit) return;

        const fromNode = idMap.get(String(edge.from));
        const toNode = idMap.get(String(edge.to));
        if (!fromNode || !toNode) return;

        let outputIndex = 0;
        if (fromNode.type === "asl/router" && edge.condition) {
            const targetName = edge.condition.toLowerCase();
            outputIndex = (fromNode.outputs || []).findIndex((output) => output.name?.toLowerCase() === targetName);
            if (outputIndex < 0) outputIndex = 0;
        }

        const targetSlot = edge.target_slot !== undefined ? edge.target_slot : 0;
        fromNode.connect(outputIndex, toNode, targetSlot);
    });

    updateSummary();
    showToast("ASL graph loaded", "success");
}

// ---------------------- Quick Actions ----------------------

export function downloadASL() {
    try {
        const asl = serializeToASL();
        downloadFile("asl_graph.json", JSON.stringify(asl, null, 2));
        showToast("ASL specification downloaded", "success");
    } catch (err) {
        showToast(err.message, "error");
    }
}

export function downloadLayout() {
    try {
        const serialized = state.graph.serialize();
        const layoutPayload = {
            nodes: serialized.nodes || [],
            links: serialized.links || [],
            groups: serialized.groups || [],
            config: { state_schema: state.appState.schema }
        };
        downloadFile("asl_layout.json", JSON.stringify(layoutPayload, null, 2));
        showToast("Layout downloaded", "success");
    } catch (err) {
        showToast(`Failed to download layout: ${err.message}`, "error");
    }
}

export function viewASL() {
    try {
        const asl = serializeToASL();
        const formatted = JSON.stringify(asl, null, 2);
        document.getElementById('asl-content').textContent = formatted;
        document.getElementById('asl-view-modal').classList.add('visible');
    } catch (err) {
        showToast(`Failed to view ASL: ${err.message}`, "error");
    }
}
