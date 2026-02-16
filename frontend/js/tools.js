// =====================================================
// ASL Editor — Tool Registry, Catalog & MCP
// =====================================================

import { state } from './state.js';
import { ASL_DEBUG } from './constants.js';
import { showToast } from './utils.js';

// =====================================================
// TOOL REGISTRY (sidebar list)
// =====================================================

export function renderToolList() {
    const toolList = document.getElementById('tool-list');
    if (!toolList) return;

    toolList.innerHTML = '';

    if (Object.keys(state.globalTools).length === 0) {
        toolList.innerHTML = '<p class="empty-state" style="padding: 12px; font-size: 0.85em;">No tools defined yet. Click "+ New Tool" to create one.</p>';
        return;
    }

    for (const [toolName, toolDef] of Object.entries(state.globalTools)) {
        const toolItem = document.createElement('div');
        toolItem.className = 'tool-registry-item';

        const toolType = toolDef.type === 'custom' ? '⚙️' : '🔌';
        const typeLabel = toolDef.type === 'custom' ? 'Custom' : 'MCP';

        toolItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div class="tool-name">${toolType} ${toolName}</div>
                    <div class="tool-desc">${toolDef.description || 'No description'}</div>
                    <div class="tool-type-label">${typeLabel}</div>
                </div>
                <div class="tool-actions">
                    ${toolDef.type === 'custom' ? `<button class="btn-tool-action edit btn-tool-edit" data-tool="${toolName}">Edit</button>` : ''}
                    ${toolDef.type === 'custom' ? `<button class="btn-tool-action delete btn-tool-delete" data-tool="${toolName}">×</button>` : ''}
                </div>
            </div>
        `;

        toolList.appendChild(toolItem);
    }

    // Event listeners
    document.querySelectorAll('.btn-tool-edit').forEach(btn => {
        btn.addEventListener('click', (e) => { openToolEditor(e.target.dataset.tool); });
    });

    document.querySelectorAll('.btn-tool-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const toolName = e.target.dataset.tool;
            if (confirm(`Delete tool "${toolName}"?`)) {
                delete state.globalTools[toolName];
                renderToolList();
                renderFunctionCatalog();
                showToast(`Tool "${toolName}" deleted`, "success");
            }
        });
    });
}

// =====================================================
// TOOL EDITOR (modal)
// =====================================================

export function openToolEditor(toolName = null) {
    const modal = document.getElementById('tool-editor-modal');
    const isEdit = toolName !== null;

    document.getElementById('tool-name').value = isEdit ? toolName : '';
    document.getElementById('tool-description').value = isEdit ? (state.globalTools[toolName].description || '') : '';
    document.getElementById('tool-return-schema').value = isEdit
        ? JSON.stringify(state.globalTools[toolName].return_schema || {}, null, 2)
        : '{"result": "Any", "success": "bool"}';
    document.getElementById('tool-implementation').value = isEdit ? (state.globalTools[toolName].implementation || '') : '';

    const argsContainer = document.getElementById('tool-arguments');
    argsContainer.innerHTML = '';

    if (isEdit && state.globalTools[toolName].arguments) {
        state.globalTools[toolName].arguments.forEach(arg => { addArgumentRow(arg); });
    }

    document.getElementById('tool-name').disabled = isEdit;
    modal.classList.add('visible');
}

export function closeToolEditor() {
    document.getElementById('tool-editor-modal').classList.remove('visible');
    document.getElementById('tool-name').disabled = false;
}

export function addArgumentRow(argData = null) {
    const argsContainer = document.getElementById('tool-arguments');
    const row = document.createElement('div');
    row.className = 'argument-row';

    row.innerHTML = `
        <input type="text" class="arg-name" placeholder="arg_name" value="${argData?.name || ''}">
        <select class="arg-type">
            <option value="str" ${argData?.type === 'str' ? 'selected' : ''}>str</option>
            <option value="int" ${argData?.type === 'int' ? 'selected' : ''}>int</option>
            <option value="float" ${argData?.type === 'float' ? 'selected' : ''}>float</option>
            <option value="bool" ${argData?.type === 'bool' ? 'selected' : ''}>bool</option>
            <option value="dict" ${argData?.type === 'dict' ? 'selected' : ''}>dict</option>
            <option value="list" ${argData?.type === 'list' ? 'selected' : ''}>list</option>
            <option value="Any" ${argData?.type === 'Any' ? 'selected' : ''}>Any</option>
        </select>
        <label>
            <input type="checkbox" class="arg-required" ${argData?.required ? 'checked' : ''}>
            Required
        </label>
        <input type="text" class="arg-description" placeholder="Description" value="${argData?.description || ''}">
        <button type="button" class="btn-remove-arg">×</button>
    `;

    row.querySelector('.btn-remove-arg').addEventListener('click', () => row.remove());
    argsContainer.appendChild(row);
}

export function collectArguments() {
    const argRows = document.querySelectorAll('.argument-row');
    const args = [];
    argRows.forEach(row => {
        const name = row.querySelector('.arg-name').value.trim();
        if (name) {
            args.push({
                name,
                type: row.querySelector('.arg-type').value,
                required: row.querySelector('.arg-required').checked,
                description: row.querySelector('.arg-description').value.trim()
            });
        }
    });
    return args;
}

export async function validateToolSyntax() {
    const code = document.getElementById('tool-implementation').value;
    const feedback = document.getElementById('syntax-feedback');

    if (!code.trim()) {
        feedback.className = 'syntax-feedback invalid';
        feedback.textContent = 'No code to validate';
        return;
    }

    try {
        const response = await fetch('/validate_tool_syntax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const result = await response.json();

        feedback.className = 'syntax-feedback';
        if (result.valid) {
            feedback.classList.add('valid');
            feedback.textContent = '✅ Syntax valid!';
        } else {
            feedback.classList.add('invalid');
            feedback.textContent = `❌ Syntax error: ${result.error}`;
        }
    } catch (err) {
        feedback.className = 'syntax-feedback invalid';
        feedback.textContent = `❌ Validation failed: ${err.message}`;
    }
}

export function saveToolDefinition() {
    const toolName = document.getElementById('tool-name').value.trim();
    const description = document.getElementById('tool-description').value.trim();
    const returnSchemaText = document.getElementById('tool-return-schema').value.trim();
    const implementation = document.getElementById('tool-implementation').value.trim();

    if (!toolName) { showToast('Tool name is required', 'error'); return; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(toolName)) { showToast('Tool name must be a valid Python identifier', 'error'); return; }
    if (!implementation) { showToast('Implementation code is required', 'error'); return; }

    let returnSchema = {};
    try { returnSchema = returnSchemaText ? JSON.parse(returnSchemaText) : {}; }
    catch { showToast('Return schema must be valid JSON', 'error'); return; }

    const args = collectArguments();

    state.globalTools[toolName] = {
        type: 'custom',
        description,
        arguments: args,
        return_schema: returnSchema,
        implementation
    };

    renderToolList();
    renderFunctionCatalog();
    closeToolEditor();
    showToast(`Tool "${toolName}" saved successfully`, 'success');
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

        const toolType = toolDef.type === 'custom' ? '⚙️' : '🔌';

        item.innerHTML = `
            <div style="font-weight: 600; font-size: 0.9em;">${toolType} ${toolName}</div>
            <div style="font-size: 0.75em;">${toolDef.description || 'No description'}</div>
        `;

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
        const configResp = await fetch('/config.json', { cache: 'no-store' });
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
            if (state.globalTools[tool.name]) return;
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
