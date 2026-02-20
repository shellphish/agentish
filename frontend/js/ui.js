// =====================================================
// ASL Editor — UI Event Bindings
// =====================================================

import { state } from './state.js';
import { ASL_DEBUG, NODE_TYPE_MAP, TOOL_TEMPLATE_ADDITION } from './constants.js';
import {
    showToast,
    downloadFile,
    normalizeSchemaToLowercase,
    renderStateSchemaDisplay,
    updateSummary
} from './utils.js';
import { ensureSingleEntry, createNode } from './nodes.js';
import { renderInspector, renderEmptyInspector } from './inspector.js';
import { serializeToASL, configureFromASL, downloadASL, downloadLayout, viewASL } from './serialization.js';
import {
    openToolEditor,
    closeToolEditor,
    addArgumentRow,
    validateToolSyntax,
    saveToolDefinition
} from './tools.js';

// =====================================================
// Public init — called once from main.js
// =====================================================

export function initUI() {
    initKeyboardShortcuts();
    initPaletteButtons();
    initDropdownMenus();
    initImportHandlers();
    initBundleModal();
    initModalHandlers();
    initToolEditorHandlers();
    initCollapsibleSidebar();
}

// ---------------------- Keyboard Shortcuts ----------------------

function initKeyboardShortcuts() {
    let copiedNode = null;

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && e.target === document.body) {
            e.preventDefault();
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        // Ctrl+C: Copy selected node
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selectedNodes = Object.values(state.canvas.selected_nodes || {});
            if (selectedNodes.length === 1) {
                copiedNode = selectedNodes[0];
                showToast("Node copied (Ctrl+V to paste)", "success");
                e.preventDefault();
            }
        }

        // Ctrl+V: Paste copied node
        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedNode) {
            const newNode = LiteGraph.createNode(copiedNode.type);
            if (newNode) {
                newNode.properties = JSON.parse(JSON.stringify(copiedNode.properties));
                newNode.title = copiedNode.title;
                newNode.size = [...copiedNode.size];
                newNode.pos = [copiedNode.pos[0] + 30, copiedNode.pos[1] + 30];
                state.graph.add(newNode);
                ensureSingleEntry(newNode);
                state.canvas.selectNode(newNode);
                updateSummary();
                showToast("Node cloned", "success");
                e.preventDefault();
            }
        }

        // Delete selected nodes
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const selectedNodes = Object.values(state.canvas.selected_nodes || {});
            if (selectedNodes.length > 0) {
                selectedNodes.forEach(node => { state.graph.remove(node); });
                state.canvas.selected_nodes = {};
                updateSummary();
                renderEmptyInspector();
                showToast("Node(s) deleted", "success");
                e.preventDefault();
            }
        }
    });
}

// ---------------------- Palette Buttons ----------------------

function initPaletteButtons() {
    const blocks = document.querySelectorAll(".block");

    blocks.forEach((btn) => {
        btn.addEventListener("click", () => { createNode(btn.dataset.nodeType); });

        btn.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("nodeType", btn.dataset.nodeType);
            e.dataTransfer.effectAllowed = "copy";
        });
    });

    // Canvas drop
    const canvasElement = document.getElementById("main-canvas");
    if (canvasElement) {
        canvasElement.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });

        canvasElement.addEventListener("drop", (e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData("nodeType");
            if (nodeType) {
                // Force canvas to recalculate bounds before converting coordinates
                state.canvas.resize();
                const graphPos = state.canvas.convertEventToCanvasOffset(e);
                createNode(nodeType, [graphPos[0], graphPos[1]]);
            }
        });
    }
}

// ---------------------- Dropdown Menus ----------------------

function initDropdownMenus() {
    // Toggle dropdown menus
    document.querySelectorAll('.dropdown-toggle').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = button.closest('.dropdown');
            const menu = dropdown.querySelector('.dropdown-menu');

            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });

            menu.classList.toggle('show');
        });
    });

    // Close on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu.show').forEach(m => { m.classList.remove('show'); });
    });

    // Dropdown item actions
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            e.target.closest('.dropdown-menu').classList.remove('show');

            switch (action) {
                case 'import-asl':     document.getElementById('file-input-asl').click(); break;
                case 'import-layout':  document.getElementById('file-input-layout').click(); break;
                case 'import-bundle':  document.getElementById('file-input-bundle').click(); break;
                case 'import-auto':    document.getElementById('file-input').click(); break;
                case 'download-asl':   downloadASL(); break;
                case 'download-layout': downloadLayout(); break;
                case 'download-bundle': await handleBundleDownload(); break;
                case 'view-asl':       viewASL(); break;
            }
        });
    });
}

// ---------------------- Import Handlers ----------------------

function initImportHandlers() {
    // Auto-detect import
    document.getElementById("file-input").addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.graph && data.graph.nodes) {
                    configureFromASL(data);
                    showToast("ASL specification loaded", "success");
                } else {
                    state.graph.configure(data);
                    if (data.extra?.stateSchema) {
                        state.appState.schema = normalizeSchemaToLowercase(data.extra.stateSchema);
                        state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
                        renderStateSchemaDisplay();
                    }
                    updateSummary();
                    showToast("Layout loaded", "success");
                }
            } catch (err) {
                showToast(`Failed to load file: ${err.message}`, "error");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    });

    // Import ASL
    document.getElementById("file-input-asl").addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.graph || !data.graph.nodes) {
                    throw new Error("Invalid ASL format: missing graph.nodes");
                }
                configureFromASL(data);
                showToast("ASL specification loaded", "success");
            } catch (err) {
                showToast(`Failed to load ASL: ${err.message}`, "error");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    });

    // Import Layout
    document.getElementById("file-input-layout").addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.graph && data.graph.nodes) {
                    throw new Error("This appears to be an ASL file. Use 'Import → ASL Specification' instead.");
                }
                if (!data.nodes || !Array.isArray(data.nodes)) {
                    throw new Error("Invalid Layout format: missing nodes array");
                }
                state.graph.configure(data);
                if (data.extra?.stateSchema) {
                    state.appState.schema = normalizeSchemaToLowercase(data.extra.stateSchema);
                    state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
                    renderStateSchemaDisplay();
                }
                if (data.config?.state_schema) {
                    state.appState.schema = normalizeSchemaToLowercase(data.config.state_schema);
                    state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
                    renderStateSchemaDisplay();
                }
                updateSummary();
                showToast("Layout loaded", "success");
            } catch (err) {
                showToast(`Failed to load layout: ${err.message}`, "error");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    });

    // Import Bundle (ZIP)
    document.getElementById("file-input-bundle").addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library not loaded. Please refresh the page.');
            }

            showToast("Extracting bundle...", "info");

            const zip = new JSZip();
            const contents = await zip.loadAsync(file);

            let aslFile = contents.file("asl_spec.json") || contents.file("asl_graph.json");

            if (aslFile) {
                const aslContent = await aslFile.async("string");
                const data = JSON.parse(aslContent);
                configureFromASL(data);
                showToast("Bundle imported (ASL specification)", "success");
            } else {
                let layoutFile = contents.file("layout.json") || contents.file("asl_layout.json");

                if (layoutFile) {
                    const layoutContent = await layoutFile.async("string");
                    const data = JSON.parse(layoutContent);
                    state.graph.configure(data);
                    if (data.extra?.stateSchema || data.config?.state_schema) {
                        state.appState.schema = normalizeSchemaToLowercase(data.extra?.stateSchema || data.config?.state_schema);
                        state.appState.schemaRaw = JSON.stringify(state.appState.schema, null, 2);
                        renderStateSchemaDisplay();
                    }
                    updateSummary();
                    showToast("Bundle imported (Layout)", "success");
                } else {
                    throw new Error("Bundle does not contain asl_spec.json or layout.json");
                }
            }
        } catch (err) {
            showToast(`Failed to import bundle: ${err.message}`, "error");
            if (ASL_DEBUG) console.error("Bundle import error:", err);
        }

        event.target.value = '';
    });
}

// ---------------------- Bundle Download Modal ----------------------

function initBundleModal() {
    const bundleModal = document.getElementById('bundle-status-modal');
    const closeBundleModalBtn = document.getElementById('close-bundle-modal');

    closeBundleModalBtn?.addEventListener('click', closeBundleModal);
    bundleModal?.addEventListener('click', (event) => {
        if (event.target === bundleModal) closeBundleModal();
    });
}

function setBadgeStatus(target, status) {
    if (!target) return;
    const badge = target.querySelector('.status-badge');
    if (!badge) return;
    badge.classList.remove('pending', 'in-progress', 'success', 'error');
    badge.classList.add(status || 'pending');
    switch (status) {
        case 'in_progress':
            badge.textContent = 'In progress';
            badge.classList.add('in-progress');
            break;
        case 'success':
            badge.textContent = 'Completed';
            badge.classList.add('success');
            break;
        case 'error':
            badge.textContent = 'Error';
            badge.classList.add('error');
            break;
        default:
            badge.textContent = 'Pending';
            badge.classList.add('pending');
    }
}

function validateASLBeforeSubmit() {
    const errors = [];
    const serializedGraph = state.graph.serialize();
    const nodes = serializedGraph.nodes || [];

    const entryNode = nodes.find(node => node.type === "asl/entry");
    if (entryNode) {
        const initialState = entryNode.properties?.initial_state || {};
        const additionalVars = Object.keys(initialState).filter(key => key !== 'count' && key !== 'messages');
        if (additionalVars.length === 0) {
            errors.push("Entry Node must have at least one additional variable in Initial State (beyond 'count' and 'messages')");
        }
    }

    nodes.forEach(node => {
        const nodeTitle = node.properties?.title || node.title || `Node ${node.id}`;

        if (node.type === "asl/worker" || node.type === "asl/llm" || node.type === "asl/router") {
            const systemPrompt = node.properties?.system_prompt;
            if (!systemPrompt || systemPrompt.trim() === '') {
                const nodeTypeName = node.type === "asl/worker" ? "Worker Node" :
                    node.type === "asl/llm" ? "LLM Node" : "Router Node";
                errors.push(`${nodeTypeName} "${nodeTitle}": System Message cannot be empty`);
            }
        }

        if (node.type === "asl/llm") {
            const schema = node.properties?.structured_output_schema;
            if (!schema || Object.keys(schema).length === 0) {
                errors.push(`LLM Node "${nodeTitle}": Output Schema cannot be empty`);
            }
        }
    });

    return { valid: errors.length === 0, errors };
}

function resetBundleModal() {
    const bundleModal = document.getElementById('bundle-status-modal');
    const bundleInfo = document.getElementById('bundle-info');
    if (bundleModal) {
        bundleModal.querySelectorAll('.submit-step').forEach(step => {
            setBadgeStatus(step, 'pending');
            const details = step.querySelector('.submit-step-details');
            if (details) details.textContent = '';
        });
        if (bundleInfo) bundleInfo.classList.add('hidden');
    }
}

function openBundleModal() {
    const bundleModal = document.getElementById('bundle-status-modal');
    if (bundleModal) { resetBundleModal(); bundleModal.classList.remove('hidden'); }
}

function closeBundleModal() {
    const bundleModal = document.getElementById('bundle-status-modal');
    if (bundleModal) { bundleModal.classList.add('hidden'); resetBundleModal(); }
}

function updateBundleStep(stepKey, status, details) {
    const bundleModal = document.getElementById('bundle-status-modal');
    if (!bundleModal) return;
    const stepEl = bundleModal.querySelector(`.submit-step[data-step="${stepKey}"]`);
    if (stepEl) {
        setBadgeStatus(stepEl, status);
        const detailsEl = stepEl.querySelector('.submit-step-details');
        if (detailsEl && details) detailsEl.textContent = details;
    }
}

async function handleBundleDownload() {
    const bundleModal = document.getElementById('bundle-status-modal');
    const bundleInfo = document.getElementById('bundle-info');

    try {
        openBundleModal();

        // Step 1: Validate
        updateBundleStep('validate', 'in_progress', 'Checking ASL specification...');
        const validation = validateASLBeforeSubmit();

        if (!validation.valid) {
            updateBundleStep('validate', 'error', validation.errors.join(' • '));
            showToast('ASL Validation failed. Please fix the errors.', 'error');
            return;
        }
        updateBundleStep('validate', 'success', 'All validations passed');

        // Step 2: Download
        updateBundleStep('download', 'in_progress', 'Creating bundle...');
        const asl = serializeToASL();

        const bundleResponse = await fetch('/api/bundle/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(asl)
        });

        if (!bundleResponse.ok) {
            const errorData = await bundleResponse.json().catch(() => ({}));
            throw new Error(errorData.error || `Bundle creation failed: HTTP ${bundleResponse.status}`);
        }

        const blob = await bundleResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const contentDisposition = bundleResponse.headers.get('content-disposition');
        let filename = 'bundle.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateBundleStep('download', 'success', 'Bundle downloaded');
        if (bundleInfo) bundleInfo.classList.remove('hidden');
        showToast('Bundle downloaded successfully!', 'success');

    } catch (err) {
        if (bundleModal) {
            const inProgressStep = bundleModal.querySelector('.submit-step .status-badge.in-progress');
            if (inProgressStep) {
                const step = inProgressStep.closest('.submit-step');
                setBadgeStatus(step, 'error');
                const details = step.querySelector('.submit-step-details');
                if (details) details.textContent = err.message;
            }
        }
        showToast(`Bundle creation failed: ${err.message}`, 'error');
    }
}

// ---------------------- Modal Handlers ----------------------

function initModalHandlers() {
    // Code modal
    document.getElementById("close-modal").addEventListener("click", () => {
        document.getElementById('code-modal').classList.remove('visible');
    });

    document.getElementById("download-code-btn").addEventListener("click", () => {
        const code = document.getElementById('generated-code').textContent;
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'compiled_agent.py';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Code downloaded", "success");
    });

    document.getElementById('code-modal').addEventListener('click', (e) => {
        if (e.target.id === 'code-modal') document.getElementById('code-modal').classList.remove('visible');
    });

    // ASL view modal
    document.getElementById("close-asl-modal").addEventListener("click", () => {
        document.getElementById('asl-view-modal').classList.remove('visible');
    });

    document.getElementById("copy-asl-btn").addEventListener("click", () => {
        const content = document.getElementById('asl-content').textContent;
        navigator.clipboard.writeText(content).then(() => {
            showToast("ASL copied to clipboard", "success");
        }).catch(() => {
            showToast("Failed to copy", "error");
        });
    });

    document.getElementById("download-asl-from-modal-btn").addEventListener("click", () => {
        try {
            const asl = serializeToASL();
            downloadFile("asl_graph.json", JSON.stringify(asl, null, 2));
            showToast("ASL downloaded", "success");
        } catch (err) {
            showToast(`Download failed: ${err.message}`, "error");
        }
    });

    document.getElementById('asl-view-modal').addEventListener('click', (e) => {
        if (e.target.id === 'asl-view-modal') document.getElementById('asl-view-modal').classList.remove('visible');
    });
}

// ---------------------- Tool Editor Handlers ----------------------

function initToolEditorHandlers() {
    document.getElementById('new-tool-btn').addEventListener('click', () => openToolEditor());
    document.getElementById('close-tool-editor').addEventListener('click', closeToolEditor);
    document.getElementById('cancel-tool-btn').addEventListener('click', closeToolEditor);
    document.getElementById('save-tool-btn').addEventListener('click', saveToolDefinition);
    document.getElementById('add-argument-btn').addEventListener('click', () => addArgumentRow());
    document.getElementById('validate-syntax-btn').addEventListener('click', validateToolSyntax);

    document.getElementById('template-selector').addEventListener('change', (e) => {
        if (e.target.value === 'addition') {
            document.getElementById('tool-implementation').value = TOOL_TEMPLATE_ADDITION;
            document.getElementById('tool-name').value = 'addition';
            document.getElementById('tool-description').value = 'Add two numbers together';
            document.getElementById('tool-return-schema').value = '{"result": "int", "success": "bool"}';

            document.getElementById('tool-arguments').innerHTML = '';
            addArgumentRow({ name: 'a', type: 'int', required: true, description: 'First number' });
            addArgumentRow({ name: 'b', type: 'int', required: true, description: 'Second number' });
        }
    });
}

// ---------------------- Collapsible Sidebar ----------------------

function initCollapsibleSidebar() {
    document.querySelectorAll('.section-heading[data-toggle-section]').forEach(heading => {
        heading.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const sectionId = heading.dataset.toggleSection;
            const section = document.getElementById(sectionId);
            if (section) section.classList.toggle('collapsed');
        });
    });
}
