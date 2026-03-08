// =====================================================
// ASL Editor — Tool Registry, Catalog & MCP
// =====================================================

import { state } from './state.js';
import { ASL_DEBUG } from './constants.js';
import { showToast, isSafeKey } from './utils.js';

// =====================================================
// TOOL REGISTRY (sidebar list)
// =====================================================

export function renderToolList() {
    // Tool registry is removed; function kept as no-op for compatibility.
}

// =====================================================
// FUNCTION CATALOG (drag-and-drop sidebar)
// =====================================================

export function renderFunctionCatalog() {
    const catalog = document.getElementById('function-catalog');
    if (!catalog) return;

    catalog.innerHTML = '';

    if (Object.keys(state.globalTools).length === 0) {
        catalog.innerHTML = '<p style="color: #718096; font-size: 0.85em; padding: 10px;">No functions yet. Create tools first.</p>';
        return;
    }

    for (const [toolName, toolDef] of Object.entries(state.globalTools)) {
        const item = document.createElement('div');
        item.draggable = true;
        item.dataset.toolName = toolName;
        item.className = 'function-item';

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: 600; font-size: 0.9em;';
        nameDiv.textContent = `🔌 ${toolName}`;

        const descDiv = document.createElement('div');
        descDiv.style.cssText = 'font-size: 0.75em;';
        descDiv.textContent = toolDef.description || 'No description';

        item.appendChild(nameDiv);
        item.appendChild(descDiv);

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('tool-name', toolName);
            e.dataTransfer.effectAllowed = 'copy';
            item.style.opacity = '0.5';
        });

        item.addEventListener('dragend', () => { item.style.opacity = '1'; });

        catalog.appendChild(item);
    }
}

// =====================================================
// MCP Tool Hydration
// =====================================================

export async function hydrateMcpTools() {
    try {
        const base = window.CHALLENGE_BASE || '';
        const configResp = await fetch(`${base}/config.json`, { cache: 'no-store' });
        if (!configResp.ok) return;
        const config = await configResp.json();
        if (!config.mcp_enabled || !config.mcp_tools_endpoint) return;

        const toolsResp = await fetch(config.mcp_tools_endpoint, { cache: 'no-store' });
        if (!toolsResp.ok) return;
        const toolData = await toolsResp.json();
        if (!toolData.success) return;

        const serverStatus = toolData.server_status || {};
        const failedServers = Object.entries(serverStatus)
            .filter(([, s]) => s.status === 'error')
            .map(([name, s]) => `${name}: ${s.error}`);

        if (failedServers.length > 0) {
            showToast(`⚠️ Some MCP servers unavailable`, 'warning');
        }

        let imported = 0;
        (toolData.tools || []).forEach((tool) => {
            if (!tool?.name) return;
            // Reject dangerous keys that would pollute Object.prototype
            if (!isSafeKey(tool.name)) return;
            if (Object.prototype.hasOwnProperty.call(state.globalTools, tool.name)) return;
            state.globalTools[tool.name] = { ...tool, type: tool.type || 'mcp' };
            imported += 1;
        });

        if (imported) {
            renderFunctionCatalog();
            const statusMsg = failedServers.length > 0
                ? `Loaded ${imported} MCP tool${imported === 1 ? '' : 's'} (some servers unavailable)`
                : `Loaded ${imported} MCP tool${imported === 1 ? '' : 's'}`;
            showToast(statusMsg, failedServers.length > 0 ? 'warning' : 'success');
        }
    } catch (err) {
        if (ASL_DEBUG) console.warn('[MCP] Failed to hydrate tools:', err);
    }
}
