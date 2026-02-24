// =====================================================
// ASL Editor — Utility Functions
// =====================================================

import { state } from './state.js';

// ---------------------- Toast Notifications ----------------------

export function showToast(message, variant = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[variant] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    const delay = variant === 'error' ? 6000 : 4000;
    setTimeout(() => dismissToast(toast), delay);
}

export function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
}

// ---------------------- File Helpers ----------------------

export function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---------------------- Type Inference ----------------------

export function inferTypeFromSchema(schemaValue) {
    if (!schemaValue) return 'str';
    const val = String(schemaValue).toLowerCase();

    if (val.includes('int')) return 'int';
    if (val.includes('float')) return 'float';
    if (val.includes('bool')) return 'bool';
    if (val.includes('list')) {
        if (val.includes('str')) return 'List[str]';
        if (val.includes('int')) return 'List[int]';
        if (val.includes('float')) return 'List[float]';
        if (val.includes('dict')) return 'List[dict]';
        return 'list';
    }
    if (val.includes('dict')) {
        if (val.includes('str') && val.includes('int')) return 'Dict[str, int]';
        if (val.includes('str') && val.includes('str')) return 'Dict[str, str]';
        return 'Dict[str, Any]';
    }
    if (val.includes('optional')) {
        if (val.includes('str')) return 'Optional[str]';
        if (val.includes('int')) return 'Optional[int]';
        if (val.includes('dict')) return 'Optional[dict]';
    }
    return 'str';
}

// ---------------------- Schema Helpers ----------------------

export function normalizeSchemaToLowercase(schema) {
    if (!schema || typeof schema !== 'object') return {};
    const normalized = {};
    for (const [key, value] of Object.entries(schema)) {
        normalized[key.toLowerCase()] = value;
    }
    return normalized;
}

export function renderStateSchemaDisplay() {
    const displayContainer = document.getElementById('state-schema-display');
    if (!displayContainer) return;

    displayContainer.innerHTML = '';

    const schema = state.appState.schema || {};
    const entries = Object.entries(schema);

    if (entries.length === 0) {
        displayContainer.innerHTML =
            '<p style="color: #94a3b8; font-size: 0.9em; padding: 10px;">No state variables defined</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'state-schema-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #334155; color: #e2e8f0; font-weight: 600;">Variable Name</th>
            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #334155; color: #e2e8f0; font-weight: 600;">Type</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    entries.forEach(([varName, varType]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 6px 8px; border-bottom: 1px solid #1e293b; color: #cbd5e1; font-family: 'JetBrains Mono', monospace; font-size: 0.75em; word-break: break-word; white-space: normal; line-height: 1.4;">${varName.toLowerCase()}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #1e293b; color: #94a3b8; font-family: 'JetBrains Mono', monospace; font-size: 0.75em; word-break: break-word; white-space: normal; line-height: 1.4;">${varType}</td>
        `;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    displayContainer.appendChild(table);
}

// ---------------------- Graph Summary ----------------------

export function updateSummary() {
    const summaryEl = document.getElementById("graph-summary");
    if (!summaryEl || !state.graph) return;

    const nodes = state.graph._nodes || [];
    const nodeCount = nodes.length;
    const edgeCount = state.graph.links ? Object.keys(state.graph.links).length : 0;
    const entryNode = nodes.find((node) => node.type === "asl/entry");
    const entryDesc = entryNode ? `#${entryNode.id}` : "unset";

    summaryEl.querySelectorAll("dd")[0].textContent = nodeCount.toString();
    summaryEl.querySelectorAll("dd")[1].textContent = edgeCount.toString();
    summaryEl.querySelectorAll("dd")[2].textContent = entryDesc;
}

// ---------------------- Canvas Helpers ----------------------

export function randomCanvasPosition() {
    const { canvas } = state;
    if (!canvas) return [100, 100];
    const viewport = canvas.viewport || [0, 0, canvas.canvas.width, canvas.canvas.height];
    const x = viewport[0] + viewport[2] / 2 + (Math.random() * 220 - 110);
    const y = viewport[1] + viewport[3] / 2 + (Math.random() * 160 - 80);
    return [x, y];
}

// ---------------------- Router Helpers ----------------------

export function getConnectedNodesForRouter(node) {
    const connectedNodes = [];
    const { graph } = state;
    if (!graph || !node.outputs) return connectedNodes;

    node.outputs.forEach(output => {
        if (!output.links) return;
        output.links.forEach(linkId => {
            const link = graph.links[linkId];
            if (!link) return;
            const targetNode = graph._nodes_by_id[link.target_id];
            if (targetNode && targetNode.properties && targetNode.properties.title) {
                if (!connectedNodes.find(n => n.id === targetNode.id)) {
                    connectedNodes.push({
                        id: targetNode.id,
                        name: targetNode.properties.title
                    });
                }
            }
        });
    });
    return connectedNodes;
}

/**
 * Formats a raw slot name for display.
 *   "next" -> "Next"
 *   "in"   -> "In" (or "In (1)" when the node has multiple input slots)
 *   "in2"  -> "In (2)"
 *   "out"  -> "Out" (or "Out (1)" when the node has multiple output slots)
 */
export function formatSlotName(name, slotCount) {
    const match = name.match(/^([a-zA-Z]+?)(\d+)?$/);
    if (!match) return name;

    const base = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const num = match[2] ? parseInt(match[2], 10) : null;

    if (num !== null) return `${base} (${num})`;
    if (slotCount > 1) return `${base} (1)`;
    return base;
}

export function syncRouterValues(node) {
    if (node.type !== "asl/router") return;

    const connectedNodes = getConnectedNodesForRouter(node);
    const existingValues = node.properties.router_values || [];
    const newValues = [];

    connectedNodes.forEach(connNode => {
        const existing = existingValues.find(v => v.node === connNode.name);
        if (existing) {
            newValues.push({ node: connNode.name, description: existing.description });
        } else {
            newValues.push({ node: connNode.name, description: "" });
        }
    });

    node.properties.router_values = newValues;
}
