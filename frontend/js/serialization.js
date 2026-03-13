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
    randomCanvasPosition,
    isSafeKey
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

// ---------------------- State Cleaner ----------------------

export function cleanStaleStateVariables() {
    const validKeys = new Set(Object.keys(state.appState.schema || {}));
    const allNodes = state.graph._nodes || [];
    allNodes.forEach(n => {
        if (!n.properties) return;
        ['input_state_keys', 'output_state_keys'].forEach(prop => {
            if (Array.isArray(n.properties[prop])) {
                n.properties[prop] = n.properties[prop].filter(k => validKeys.has(k));
            }
        });
        if (Array.isArray(n.properties.structured_output_schema)) {
            n.properties.structured_output_schema = n.properties.structured_output_schema.filter(
                row => !row.name || validKeys.has(row.name)
            );
        }
    });
}

// ---------------------- ASL Export ----------------------

export function serializeToASL() {
    cleanStaleStateVariables();

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
            tools: Object.fromEntries(
                Object.entries(state.globalTools).filter(([, def]) => def.type !== 'custom')
            )
        }
    };
}

// ---------------------- ASL Import ----------------------

export function configureFromASL(asl) {
    state.graph.clear();
    const { graph: graphData } = asl;
    //console.log("Configuring graph from ASL data:", graphData);
    state.appState.schema = normalizeSchemaToLowercase(graphData?.state?.schema || {});
    state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
    renderStateSchemaDisplay();
    state.appState.entrypointId = null;

    // Load tools — never assign the raw parsed object directly.
    // Iterate with an explicit hasOwnProperty guard and a safe-key check
    // to prevent prototype pollution via __proto__ / constructor / prototype keys.
    state.globalTools = {};
    const rawTools = graphData?.tools;
    if (rawTools && typeof rawTools === 'object' && !Array.isArray(rawTools)) {
        for (const key of Object.keys(rawTools)) {
            if (!Object.prototype.hasOwnProperty.call(rawTools, key)) continue;
            if (!isSafeKey(key)) continue;
            if (rawTools[key]?.type === 'custom') continue; // custom tools not supported
            state.globalTools[key] = rawTools[key];
        }
    }
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

    // Warn on import if any LLM fans out to more than 1 other LLM node
    const importedNodes = asl?.graph?.nodes || [];
    const importedEdges = asl?.graph?.edges || [];
    const importedLlmIds = new Set(importedNodes.filter(n => n.type === "LLMNode").map(n => String(n.id)));
    for (const id of importedLlmIds) {
        const llmTargets = importedEdges.filter(
            e => String(e.from) === id && importedLlmIds.has(String(e.to))
        );
        if (llmTargets.length > 1) {
            const n = importedNodes.find(n => String(n.id) === id);
            showToast(
                `Warning: LLM node '${n?.label || id}' connects to ${llmTargets.length} other LLM nodes — this will fail validation.`,
                "warning"
            );
        }
    }

    showToast("ASL graph loaded", "success");
}

// ---------------------- Quick Actions ----------------------

// ---- Topology validator (mirrors guardian_check in agentish-ctf/compiler/validator_guardian.py) ----
// Node types in exported ASL: "LLMNode", "RouterBlock", "WorkerNode", "EntryPoint"

function _validateTopology(asl) {
    const errors = [];
    const warnings = [];

    const graph = asl && asl.graph;
    if (!graph) return { errors: ["No graph found in ASL."], warnings };

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const entryId = graph.entrypoint != null ? String(graph.entrypoint) : null;

    const llmIds    = new Set(nodes.filter(n => n.type === "LLMNode").map(n => String(n.id)));
    const routerIds = new Set(nodes.filter(n => n.type === "RouterBlock").map(n => String(n.id)));
    const workerIds = new Set(nodes.filter(n => n.type === "WorkerNode").map(n => String(n.id)));
    const flowIds   = new Set([...llmIds, ...routerIds]);

    const nodeById = new Map(nodes.map(n => [String(n.id), n]));
    const label = (id) => {
        const n = nodeById.get(String(id));
        return n ? `'${n.label || id}' (id=${id})` : `(id=${id})`;
    };

    // Build flow adjacency list — skip worker-target edges (tool-binding only)
    const flowAdj = new Map([...flowIds].map(id => [id, []]));
    if (entryId) flowAdj.set(entryId, flowAdj.get(entryId) ?? []);

    const hasIncoming       = new Map([...flowIds].map(id => [id, false]));
    const workerHasIncoming = new Map([...workerIds].map(id => [id, false]));

    for (const edge of edges) {
        const fromId = String(edge.from);
        const toId   = String(edge.to);

        if (workerIds.has(toId)) {
            workerHasIncoming.set(toId, true);
            continue;
        }
        if (flowIds.has(toId)) {
            hasIncoming.set(toId, true);
        }
        if (flowAdj.has(fromId)) {
            flowAdj.get(fromId).push(toId);
        }
    }

    // Check 4: Entry has exactly one outgoing edge to an LLM node
    if (!entryId) {
        errors.push("No entry node found in the graph.");
    } else {
        const entryOutgoing = flowAdj.get(entryId) || [];
        if (entryOutgoing.length === 0) {
            errors.push("Entry node has no outgoing edge. Connect it to an LLM Node.");
        } else if (entryOutgoing.length > 1) {
            errors.push(
                `Entry node has ${entryOutgoing.length} outgoing edges. ` +
                `It must have exactly one, connecting directly to an LLM Node.`
            );
        } else {
            const entryTargetId = entryOutgoing[0];
            if (!llmIds.has(entryTargetId)) {
                const targetNode = nodeById.get(entryTargetId);
                const targetType = targetNode ? targetNode.type : "Unknown";
                errors.push(
                    `Entry node must connect directly to an LLM Node, ` +
                    `but it connects to a ${targetType} node (${label(entryTargetId)}).`
                );
            }
        }
    }

    // Check 1: At least one terminal LLM node
    const terminalLlms = [...llmIds].filter(id => (flowAdj.get(id) || []).length === 0);
    if (terminalLlms.length === 0) {
        errors.push(
            "No terminal LLM node found. At least one LLM node must have no " +
            "outgoing flow edge so the graph can reach END."
        );
    }

    // Check 2a: No orphan LLM/Router nodes
    for (const id of flowIds) {
        if (!hasIncoming.get(id)) {
            errors.push(`Node ${label(id)} has no incoming flow edge and is unreachable.`);
        }
    }

    // Check 2b: Every Worker referenced by at least one LLM
    for (const id of workerIds) {
        if (!workerHasIncoming.get(id)) {
            errors.push(
                `Worker node ${label(id)} is not connected to any LLM node and will never be called.`
            );
        }
    }

    // Check 3: Router fanout >= 2
    for (const id of routerIds) {
        const outgoing = flowAdj.get(id) || [];
        if (outgoing.length < 2) {
            errors.push(
                `Router node ${label(id)} has ${outgoing.length} outgoing flow edge(s). ` +
                `Routers must have at least 2.`
            );
        }
    }

    // Check 8: LLM nodes may connect to at most 1 other LLM node
    for (const id of llmIds) {
        const llmTargets = (flowAdj.get(id) || []).filter(tid => llmIds.has(tid));
        if (llmTargets.length > 1) {
            errors.push(
                `LLM node ${label(id)} connects to ${llmTargets.length} other LLM nodes. ` +
                `An LLM node may connect to at most 1 other LLM node.`
            );
        }
    }

    // Check 6: input_state_keys must be non-empty for all LLM/Router nodes except the entry-connected LLM
    const entryConnectedLlmId = (() => {
        const entryOut = entryId ? (flowAdj.get(entryId) || []) : [];
        return entryOut.length === 1 && llmIds.has(entryOut[0]) ? entryOut[0] : null;
    })();

    for (const node of nodes) {
        const nId = String(node.id);
        if (nId === entryId) continue;
        if (nId === entryConnectedLlmId) continue;
        if (llmIds.has(nId) || routerIds.has(nId)) {
            const keys = node.config?.input_state_keys || [];
            if (keys.length === 0) {
                errors.push(`Node ${label(nId)} has no Input State selected. Select at least one state variable.`);
            }
        }
    }

    // Check 7: Router nodes must have descriptions for all routes
    for (const id of routerIds) {
        const node = nodeById.get(id);
        const routerValues = node?.config?.router_values || [];
        const missingCount = routerValues.filter(rv => !rv.description || rv.description.trim() === '').length;
        if (missingCount > 0) {
            errors.push(`Router node ${label(id)} has ${missingCount} route(s) with missing descriptions.`);
        }
    }

    // Check 5: Loop LLM nodes must declare loop_mode
    for (const id of llmIds) {
        const incomingCount = edges.filter(
            e => String(e.to) === id && !workerIds.has(String(e.from))
        ).length;
        if (incomingCount > 1) {
            const n = nodeById.get(id);
            const lm = n?.config?.loop_mode || "";
            if (lm !== "fresh" && lm !== "continue") {
                errors.push(
                    `LLM node ${label(id)} has multiple incoming edges but 'loop_mode' is not ` +
                    `configured or has an invalid value. Set it to 'fresh' or 'continue' in the node inspector.`
                );
            } else if (lm === "continue" && !(n?.config?.loop_feedback_state_key || "")) {
                warnings.push(
                    `LLM node ${label(id)} uses continue mode but no feedback state variable is set. ` +
                    `The node will re-run with prior history but no new context injected.`
                );
            }
        }
    }

    // DFS cycle detection (white/gray/black coloring)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...flowIds].map(id => [id, WHITE]));
    const cycles = [];

    function dfs(nodeId, path) {
        color.set(nodeId, GRAY);
        path.push(nodeId);
        for (const neighbor of (flowAdj.get(nodeId) || [])) {
            if (!color.has(neighbor)) continue;
            if (color.get(neighbor) === GRAY) {
                const cycleStart = path.indexOf(neighbor);
                cycles.push(path.slice(cycleStart));
            } else if (color.get(neighbor) === WHITE) {
                dfs(neighbor, path);
            }
        }
        path.pop();
        color.set(nodeId, BLACK);
    }

    for (const id of flowIds) {
        if (color.get(id) === WHITE) dfs(id, []);
    }

    // Classify cycles
    for (const cycle of cycles) {
        const cycleSet    = new Set(cycle);
        const cycleLabels = cycle.map(label).join(", ");
        const hasRouterInCycle = cycle.some(id => routerIds.has(id));

        if (!hasRouterInCycle) {
            errors.push(
                `Infinite loop detected: [${cycleLabels}] contains no Router node and will loop forever.`
            );
        } else {
            const routersInCycle = cycle.filter(id => routerIds.has(id));
            const hasExit = routersInCycle.some(rid =>
                (flowAdj.get(rid) || []).some(neighbor => !cycleSet.has(neighbor))
            );
            if (!hasExit) {
                errors.push(
                    `Infinite loop detected: [${cycleLabels}] contains a Router but all ` +
                    `its outgoing edges stay within the cycle.`
                );
            } else {
                warnings.push(
                    `Cycle detected: [${cycleLabels}]. Contains a Router with an exit path. ` +
                    `Ensure the Router has a clear exit condition.`
                );
            }
        }
    }

    return { errors, warnings };
}

export { _validateTopology as validateTopology };

export function downloadASL() {
    try {
        const asl = serializeToASL();
        const { errors, warnings } = _validateTopology(asl);
        warnings.forEach(w => showToast(w, "warning"));
        if (errors.length > 0) {
            errors.forEach(e => showToast(e, "error"));
            return;
        }
        downloadFile("asl_graph.json", JSON.stringify(asl, null, 2));
        showToast("ASL specification downloaded", "success");
    } catch (err) {
        showToast(err.message, "error");
    }
}

export function serializeToLayout() {
    const serialized = state.graph.serialize();
    return {
        last_node_id: serialized.last_node_id,
        last_link_id: serialized.last_link_id,
        nodes: serialized.nodes || [],
        links: serialized.links || [],
        groups: serialized.groups || [],
        config: { state_schema: state.appState.schema }
    };
}

export function downloadLayout() {
    try {
        const layoutPayload = serializeToLayout();
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
