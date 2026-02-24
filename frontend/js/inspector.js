// =====================================================
// ASL Editor — Inspector Panel
// =====================================================

import { state } from './state.js';
import { NODE_FORMS, DEFAULT_SCHEMA } from './constants.js';
import {
    showToast,
    inferTypeFromSchema,
    renderStateSchemaDisplay,
    syncRouterValues,
    getConnectedNodesForRouter
} from './utils.js';

// ---------------------- Empty State ----------------------

export function renderEmptyInspector() {
    const container = document.getElementById("node-properties");
    if (!container) return;
    container.classList.add("empty-state");
    container.innerHTML = `
        <strong>No node selected.</strong>
        <p>Select a block to configure prompts, routing, and memory.</p>
    `;
}

// ---------------------- List Field (pills) ----------------------

function renderListField(def, node, wrapper) {
    const list = Array.isArray(node.properties?.[def.key])
        ? [...node.properties[def.key]]
        : [];

    const pillContainer = document.createElement("div");
    pillContainer.className = "list-pill-container";

    const inputRow = document.createElement("div");
    inputRow.className = "list-input";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = def.placeholder || "Add value";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Add";

    function commit(newList) {
        node.properties[def.key] = newList;
        state.graph.setDirtyCanvas(true, true);
        if (node.type === "asl/llm" && def.key === "selected_tools") {
            renderInspector(node);
        }
    }

    function renderPills(values) {
        pillContainer.innerHTML = "";
        values.forEach((value, index) => {
            const pill = document.createElement("span");
            pill.className = "list-pill";
            pill.textContent = value;
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "×";
            removeBtn.title = "Remove";
            removeBtn.addEventListener("click", () => {
                const updated = values.filter((_, i) => i !== index);
                renderPills(updated);
                commit(updated);
            });
            pill.appendChild(removeBtn);
            pillContainer.appendChild(pill);
        });
    }

    addBtn.addEventListener("click", () => {
        const value = input.value.trim();
        if (!value) return;
        const updated = [...(node.properties[def.key] || []), value];
        input.value = "";
        renderPills(updated);
        commit(updated);
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addBtn.click();
        }
    });

    renderPills(list);
    inputRow.appendChild(input);
    inputRow.appendChild(addBtn);
    wrapper.appendChild(pillContainer);
    wrapper.appendChild(inputRow);
}

// ---------------------- Tool Drop List (drag-only, no text input) ----------------------

function renderToolDropList(def, node, wrapper) {
    const list = Array.isArray(node.properties?.[def.key])
        ? [...node.properties[def.key]]
        : [];

    const pillContainer = document.createElement("div");
    pillContainer.className = "list-pill-container";

    function commit(newList) {
        node.properties[def.key] = newList;
        state.graph.setDirtyCanvas(true, true);
        renderInspector(node);
    }

    function renderPills(values) {
        pillContainer.innerHTML = "";
        values.forEach((value, index) => {
            const pill = document.createElement("span");
            pill.className = "list-pill";
            pill.textContent = value;
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "\u00d7";
            removeBtn.title = "Remove";
            removeBtn.addEventListener("click", () => {
                const updated = values.filter((_, i) => i !== index);
                commit(updated);
            });
            pill.appendChild(removeBtn);
            pillContainer.appendChild(pill);
        });
    }

    renderPills(list);
    wrapper.appendChild(pillContainer);

    if (list.length === 0) {
        const hint = document.createElement("small");
        hint.className = "tool-drop-hint";
        hint.textContent = "Drag tools from the Function Catalog onto the node to add them.";
        wrapper.appendChild(hint);
    }
}

// ---------------------- Output Schema Table ----------------------

function renderOutputSchemaTable(def, node, wrapper) {
    const TYPE_OPTIONS = [
        'str', 'int', 'float', 'bool', 'Any',
        'List[str]', 'List[int]', 'List[float]', 'List[dict]',
        'Dict[str, str]', 'Dict[str, int]', 'Dict[str, Any]',
        'Optional[str]', 'Optional[int]', 'Optional[dict]'
    ];

    const schemaArray = node.properties[def.key] || [];

    const tableContainer = document.createElement('div');
    tableContainer.className = 'output-schema-table-container';

    const table = document.createElement('table');
    table.className = 'output-schema-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Variable Name</th>
            <th>Type</th>
            <th>Description</th>
            <th style="width: 40px;"></th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'output-schema-tbody';
    table.appendChild(tbody);

    function validateUniqueNames() {
        const names = [];
        const rows = tbody.querySelectorAll('tr');
        let hasDuplicates = false;
        rows.forEach(row => {
            const nameInput = row.querySelector('.field-name-input');
            if (nameInput) {
                const name = nameInput.value.trim();
                if (name) {
                    const isDuplicate = names.includes(name);
                    if (isDuplicate) {
                        nameInput.classList.add('input-error');
                        hasDuplicates = true;
                    } else {
                        nameInput.classList.remove('input-error');
                        names.push(name);
                    }
                }
            }
        });
        return !hasDuplicates;
    }

    function updateNodeProperty() {
        const rows = tbody.querySelectorAll('tr');
        const newSchema = [];
        rows.forEach(row => {
            const nameInput = row.querySelector('.field-name-input');
            const typeSelect = row.querySelector('.field-type-select');
            const descInput = row.querySelector('.field-desc-input');
            const name = nameInput.value.trim();
            const type = typeSelect.value;
            const description = descInput.value.trim();
            if (name && type && description) {
                newSchema.push({ name, type, description });
            }
        });
        node.properties[def.key] = newSchema;
        state.graph.setDirtyCanvas(true, true);
        if (newSchema.length === 0) {
            showToast("Output Schema cannot be empty", "error");
        }
    }

    function createRow(field = null) {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'field-name-input';
        nameInput.value = field?.name || '';
        nameInput.placeholder = 'field_name';
        nameInput.addEventListener('input', () => { validateUniqueNames(); updateNodeProperty(); });
        nameInput.addEventListener('blur', () => { validateUniqueNames(); });
        tdName.appendChild(nameInput);
        tr.appendChild(tdName);

        const tdType = document.createElement('td');
        const typeSelect = document.createElement('select');
        typeSelect.className = 'field-type-select';
        TYPE_OPTIONS.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            if (field && field.type === type) option.selected = true;
            typeSelect.appendChild(option);
        });
        typeSelect.addEventListener('change', updateNodeProperty);
        tdType.appendChild(typeSelect);
        tr.appendChild(tdType);

        const tdDesc = document.createElement('td');
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'field-desc-input';
        descInput.value = field?.description || '';
        descInput.placeholder = 'Description (required)';
        descInput.addEventListener('input', updateNodeProperty);
        tdDesc.appendChild(descInput);
        tr.appendChild(tdDesc);

        const tdAction = document.createElement('td');
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-remove-field';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Remove field';
        deleteBtn.addEventListener('click', () => {
            tr.remove();
            updateNodeProperty();
            validateUniqueNames();
            if (field?.name) {
                const checkboxes = document.querySelectorAll('.checkbox-item input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    if (cb.value === field.name) cb.checked = false;
                });
            }
        });
        tdAction.appendChild(deleteBtn);
        tr.appendChild(tdAction);

        return tr;
    }

    function renderRows() {
        tbody.innerHTML = '';
        schemaArray.forEach(field => { tbody.appendChild(createRow(field)); });
    }

    const addFieldBtn = document.createElement('button');
    addFieldBtn.type = 'button';
    addFieldBtn.className = 'btn-add-field';
    addFieldBtn.textContent = '+ Add Field';
    addFieldBtn.addEventListener('click', () => {
        const newRow = createRow();
        tbody.appendChild(newRow);
        newRow.querySelector('.field-name-input').focus();
    });

    tableContainer.addSchemaRow = function (fieldName, fieldType = 'str', fieldDesc = '') {
        const existingRows = tbody.querySelectorAll('tr');
        for (let row of existingRows) {
            const nameInput = row.querySelector('.field-name-input');
            if (nameInput && nameInput.value === fieldName) return;
        }
        const newRow = createRow({ name: fieldName, type: fieldType, description: fieldDesc });
        tbody.appendChild(newRow);
        updateNodeProperty();
        validateUniqueNames();
    };

    tableContainer.removeSchemaRow = function (fieldName) {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const nameInput = row.querySelector('.field-name-input');
            if (nameInput && nameInput.value === fieldName) row.remove();
        });
        updateNodeProperty();
        validateUniqueNames();
    };

    renderRows();
    validateUniqueNames();

    tableContainer.appendChild(table);
    tableContainer.appendChild(addFieldBtn);
    wrapper.appendChild(tableContainer);
}

// ---------------------- Initial State Table ----------------------

function renderInitialStateTable(def, node, wrapper) {
    const initialState = node.properties[def.key] || {};

    const tableContainer = document.createElement('div');
    tableContainer.className = 'initial-state-table-container';

    const table = document.createElement('table');
    table.className = 'initial-state-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Variable Name</th>
            <th>Type</th>
            <th style="width: 40px;"></th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'initial-state-tbody';
    table.appendChild(tbody);

    const TYPE_OPTIONS = [
        'int', 'str', 'float', 'bool',
        'List[str]', 'List[int]', 'List[float]', 'List[dict]',
        'Dict[str, str]', 'Dict[str, int]', 'Dict[str, Any]',
        'Optional[str]', 'Optional[int]', 'Optional[dict]',
        'Any'
    ];

    function validateUniqueNames() {
        const names = [];
        const rows = tbody.querySelectorAll('tr');
        let hasDuplicates = false;

        rows.forEach(row => {
            const nameInput = row.querySelector('.var-name-input');
            if (nameInput) {
                const name = nameInput.value.trim();
                if (name) {
                    if (name.includes(' ')) {
                        nameInput.classList.add('input-error');
                        nameInput.title = 'Variable name cannot contain spaces';
                        hasDuplicates = true;
                        return;
                    }
                    const validPattern = /^[a-z0-9_]+$/;
                    if (!validPattern.test(name)) {
                        nameInput.classList.add('input-error');
                        nameInput.title = 'Only lowercase letters (a-z), numbers (0-9), and underscore (_) allowed';
                        hasDuplicates = true;
                        return;
                    }
                    const lowerName = name.toLowerCase();
                    if (lowerName === 'count' || lowerName === 'messages') {
                        nameInput.classList.add('input-error');
                        nameInput.title = 'Reserved variable name (count and messages are automatic)';
                        hasDuplicates = true;
                        return;
                    }
                    const isDuplicate = names.includes(lowerName);
                    if (isDuplicate) {
                        nameInput.classList.add('input-error');
                        nameInput.title = 'Duplicate variable name';
                        hasDuplicates = true;
                    } else {
                        nameInput.classList.remove('input-error');
                        nameInput.title = '';
                        names.push(lowerName);
                    }
                }
            }
        });
        return !hasDuplicates;
    }

    function updateNodeProperty() {
        const rows = tbody.querySelectorAll('tr');
        const newInitialState = {};

        rows.forEach(row => {
            const nameInput = row.querySelector('.var-name-input');
            const typeSelect = row.querySelector('.var-type-select');
            const name = nameInput.value.trim();
            const type = typeSelect.value;
            if (name && type) {
                const lowerName = name.toLowerCase();
                newInitialState[lowerName] = type;
                if (nameInput.value !== lowerName) nameInput.value = lowerName;
            }
        });

        node.properties[def.key] = newInitialState;

        const mergedSchema = { ...DEFAULT_SCHEMA, ...newInitialState };
        state.appState.schema = mergedSchema;
        state.appState.schemaRaw = JSON.stringify(mergedSchema, null, 2);
        renderStateSchemaDisplay();

        state.graph.setDirtyCanvas(true, true);
    }

    function createRow(varName = '', varType = 'str') {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'var-name-input';
        nameInput.value = varName;
        nameInput.placeholder = 'variable_name';
        nameInput.addEventListener('input', (e) => {
            const currentValue = e.target.value;
            if (currentValue.includes(' ')) showToast("Variable name cannot contain spaces", "error");
            const validPattern = /^[a-z0-9_]*$/;
            if (currentValue && !validPattern.test(currentValue)) {
                showToast("Only lowercase letters (a-z), numbers (0-9), and underscore (_) allowed", "error");
            }
            validateUniqueNames();
            updateNodeProperty();
        });
        nameInput.addEventListener('blur', () => { validateUniqueNames(); });
        tdName.appendChild(nameInput);
        tr.appendChild(tdName);

        const tdType = document.createElement('td');
        const typeSelect = document.createElement('select');
        typeSelect.className = 'var-type-select';
        TYPE_OPTIONS.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            if (varType === type) option.selected = true;
            typeSelect.appendChild(option);
        });
        typeSelect.addEventListener('change', updateNodeProperty);
        tdType.appendChild(typeSelect);
        tr.appendChild(tdType);

        const tdAction = document.createElement('td');
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-remove-field';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Remove variable';
        deleteBtn.addEventListener('click', () => {
            tr.remove();
            updateNodeProperty();
            validateUniqueNames();
        });
        tdAction.appendChild(deleteBtn);
        tr.appendChild(tdAction);

        return tr;
    }

    function renderRows() {
        tbody.innerHTML = '';
        for (const [varName, varType] of Object.entries(initialState)) {
            if (varName === 'count' || varName === 'messages') continue;
            tbody.appendChild(createRow(varName, varType));
        }
    }

    const addVarBtn = document.createElement('button');
    addVarBtn.type = 'button';
    addVarBtn.className = 'btn-add-field';
    addVarBtn.textContent = '+ Add Variable';
    addVarBtn.addEventListener('click', () => {
        const newRow = createRow();
        tbody.appendChild(newRow);
        newRow.querySelector('.var-name-input').focus();
    });

    renderRows();
    validateUniqueNames();

    tableContainer.appendChild(table);
    tableContainer.appendChild(addVarBtn);
    wrapper.appendChild(tableContainer);
}

// ---------------------- Router Values Table ----------------------

function renderRouterValuesTable(def, node, wrapper) {
    syncRouterValues(node);
    const syncedValues = node.properties[def.key] || [];

    const tableContainer = document.createElement('div');
    tableContainer.className = 'router-values-table-container';

    const connectedNodes = getConnectedNodesForRouter(node);

    if (connectedNodes.length === 0) {
        const helperMsg = document.createElement('p');
        helperMsg.className = 'router-values-helper';
        helperMsg.textContent = "Connect nodes from this router's output to define routing options";
        tableContainer.appendChild(helperMsg);
        wrapper.appendChild(tableContainer);
        return;
    }

    const table = document.createElement('table');
    table.className = 'router-values-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th style="width: 40%;">Node Name</th>
            <th>Description</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'router-values-tbody';
    table.appendChild(tbody);

    function validateDescriptions() {
        const rows = tbody.querySelectorAll('tr');
        let allValid = true;
        rows.forEach(row => {
            const descInput = row.querySelector('.router-desc-input');
            if (descInput) {
                const desc = descInput.value.trim();
                if (!desc) { descInput.classList.add('input-error'); allValid = false; }
                else { descInput.classList.remove('input-error'); }
            }
        });
        if (!allValid) showToast("All router values must have descriptions", "error");
        return allValid;
    }

    function updateNodeProperty() {
        const rows = tbody.querySelectorAll('tr');
        const newValues = [];
        rows.forEach(row => {
            const nodeNameSpan = row.querySelector('.router-node-name');
            const descInput = row.querySelector('.router-desc-input');
            newValues.push({
                node: nodeNameSpan.textContent,
                description: descInput.value.trim()
            });
        });
        node.properties[def.key] = newValues;
        state.graph.setDirtyCanvas(true, true);
    }

    function createRow(value) {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'router-node-name';
        nameSpan.textContent = value.node;
        nameSpan.style.fontWeight = '600';
        nameSpan.style.fontFamily = 'var(--font-mono)';
        tdName.appendChild(nameSpan);
        tr.appendChild(tdName);

        const tdDesc = document.createElement('td');
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'router-desc-input';
        descInput.value = value.description || '';
        descInput.placeholder = 'Description (required)';
        descInput.addEventListener('input', () => {
            updateNodeProperty();
            if (descInput.value.trim()) descInput.classList.remove('input-error');
        });
        descInput.addEventListener('blur', validateDescriptions);
        tdDesc.appendChild(descInput);
        tr.appendChild(tdDesc);

        return tr;
    }

    function renderRows() {
        tbody.innerHTML = '';
        syncedValues.forEach(value => { tbody.appendChild(createRow(value)); });
    }

    renderRows();
    validateDescriptions();

    tableContainer.appendChild(table);
    wrapper.appendChild(tableContainer);
}

// ---------------------- Main Inspector ----------------------

export function renderInspector(node) {
    const nodePropertiesContainer = document.getElementById("node-properties");
    if (!nodePropertiesContainer) return;

    if (!node) {
        renderEmptyInspector();
        return;
    }

    nodePropertiesContainer.classList.remove("empty-state");
    nodePropertiesContainer.innerHTML = "";

    const fragment = document.createDocumentFragment();
    const title = document.createElement("h3");
    title.textContent = node.title || "Node";
    fragment.appendChild(title);

    const form = document.createElement("form");
    form.className = "controls-grid";
    form.addEventListener("submit", (e) => { e.preventDefault(); return false; });

    const formDefs = NODE_FORMS[node.type] || [];
    formDefs.forEach((def) => {
        // Skip hidden fields (functionality preserved, just not shown)
        if (def.hidden) return;

        // Handle conditional rendering
        if (def.conditional) {
            if (def.conditional.field && def.conditional.value !== undefined) {
                if (node.properties?.[def.conditional.field] !== def.conditional.value) return;
            } else if (def.conditional.field && def.conditional.hasItems) {
                const arr = node.properties?.[def.conditional.field];
                if (!Array.isArray(arr) || arr.length === 0) return;
            }
        }

        const wrapper = document.createElement("div");
        wrapper.className = "control-group";

        const label = document.createElement("label");
        label.textContent = def.label;
        wrapper.appendChild(label);

        if (def.description) {
            const hint = document.createElement("small");
            hint.textContent = def.description;
            wrapper.appendChild(hint);
        }

        const currentValue = node.properties?.[def.key];
        let input;

        // Delegate to specialised renderers
        if (def.type === "tool_drop_list") { renderToolDropList(def, node, wrapper); form.appendChild(wrapper); return; }
        if (def.type === "list") { renderListField(def, node, wrapper); form.appendChild(wrapper); return; }
        if (def.type === "output_schema_table") { renderOutputSchemaTable(def, node, wrapper); form.appendChild(wrapper); return; }
        if (def.type === "initial_state_table") { renderInitialStateTable(def, node, wrapper); form.appendChild(wrapper); return; }
        if (def.type === "router_values_table") { renderRouterValuesTable(def, node, wrapper); form.appendChild(wrapper); return; }

        // State checkboxes
        if (def.type === "state_checkboxes") {
            const stateVars = Object.keys(state.appState.schema || {})
                .map(key => key.toLowerCase())
                .filter(key => key !== "count" && key !== "messages");

            if (stateVars.length === 0) {
                const hint = document.createElement("small");
                hint.textContent = "No additional state variables defined. Add them in Entry Node's Initial State.";
                hint.style.color = "#94a3b8";
                wrapper.appendChild(hint);
            } else {
                const checkboxContainer = document.createElement("div");
                checkboxContainer.className = "checkbox-group";

                let selectedKeys = (node.properties?.[def.key] || []).map(k => k.toLowerCase());

                stateVars.forEach(varName => {
                    const checkboxWrapper = document.createElement("label");
                    checkboxWrapper.className = "checkbox-item";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.value = varName.toLowerCase();
                    checkbox.checked = selectedKeys.includes(varName.toLowerCase());

                    checkbox.addEventListener("change", () => {
                        let updated = (node.properties[def.key] || []).map(k => k.toLowerCase());
                        const lowerVarName = varName.toLowerCase();
                        if (checkbox.checked) {
                            if (!updated.includes(lowerVarName)) updated.push(lowerVarName);
                        } else {
                            updated = updated.filter(k => k !== lowerVarName);
                        }
                        node.properties[def.key] = updated;

                        if (def.key === "output_state_keys") {
                            const schemaTableContainer = document.querySelector('.output-schema-table-container');
                            if (schemaTableContainer) {
                                if (checkbox.checked) {
                                    const fieldType = inferTypeFromSchema(state.appState.schema[varName]) || 'str';
                                    schemaTableContainer.addSchemaRow(varName.toLowerCase(), fieldType, '');
                                } else {
                                    schemaTableContainer.removeSchemaRow(varName.toLowerCase());
                                }
                            }
                        }

                        state.graph.setDirtyCanvas(true, true);
                    });

                    const labelText = document.createElement("span");
                    labelText.textContent = varName.toLowerCase();

                    checkboxWrapper.appendChild(checkbox);
                    checkboxWrapper.appendChild(labelText);
                    checkboxContainer.appendChild(checkboxWrapper);
                });

                wrapper.appendChild(checkboxContainer);
            }

            form.appendChild(wrapper);
            return;
        }

        // Standard field types
        switch (def.type) {
            case "textarea":
            case "code": {
                input = document.createElement("textarea");
                input.value = currentValue ?? "";
                input.rows = def.rows || (def.type === "code" ? 10 : 4);
                input.placeholder = def.placeholder || "";
                input.spellcheck = false;
                if (def.type === "code") input.classList.add("code-input");
                break;
            }
            case "json": {
                input = document.createElement("textarea");
                input.value = currentValue ? JSON.stringify(currentValue, null, 2) : "";
                input.placeholder = def.placeholder || "";
                input.spellcheck = false;
                input.rows = def.rows || 6;
                input.dataset.isJson = "true";
                break;
            }
            case "checkbox": {
                input = document.createElement("input");
                input.type = "checkbox";
                input.checked = Boolean(currentValue ?? false);
                break;
            }
            case "select": {
                input = document.createElement("select");
                (def.options || []).forEach((option) => {
                    const opt = document.createElement("option");
                    opt.value = option.value;
                    opt.textContent = option.label;
                    input.appendChild(opt);
                });
                input.value = currentValue ?? def.options?.[0]?.value ?? "";
                break;
            }
            case "number": {
                input = document.createElement("input");
                input.type = "number";
                if (typeof def.min === "number") input.min = def.min;
                if (typeof def.max === "number") input.max = def.max;
                if (typeof def.step === "number") input.step = def.step;
                input.placeholder = def.placeholder || "";
                if (currentValue !== undefined && currentValue !== null && currentValue !== "") {
                    input.value = String(currentValue);
                } else if (def.default !== undefined) {
                    input.value = String(def.default);
                } else {
                    input.value = "";
                }
                break;
            }
            default: {
                input = document.createElement("input");
                input.type = "text";
                input.value = currentValue ?? "";
                input.placeholder = def.placeholder || "";
                break;
            }
        }

        input.addEventListener("input", () => {
            let value = input.value;
            if (def.type === "checkbox") {
                value = input.checked;
            } else if (def.type === "number") {
                const previousValue = node.properties?.[def.key];
                if (value === "") {
                    showToast(`${def.label} requires a value`, "error");
                    input.classList.add("input-error");
                    input.value = previousValue ?? "";
                    return;
                }
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) {
                    showToast(`${def.label} must be a valid number`, "error");
                    input.classList.add("input-error");
                    input.value = previousValue ?? "";
                    return;
                }
                let normalized = parsed;
                if (typeof def.min === "number" && normalized < def.min) normalized = def.min;
                if (typeof def.max === "number" && normalized > def.max) normalized = def.max;
                value = Math.trunc(normalized);
                input.value = String(value);
                input.classList.remove("input-error");
            }
            if (input.dataset.isJson === "true") {
                try {
                    value = value ? JSON.parse(value) : def.type === "json" && def.key === "arguments" ? [] : {};
                    input.classList.remove("input-error");
                } catch (err) {
                    input.classList.add("input-error");
                    showToast(`Invalid JSON for ${def.label}`, "error");
                    return;
                }
            }
            node.properties[def.key] = value;

            if (def.key === "title") {
                node.title = value || node.type;
                node._wrappedTitleLines = null;
                node._titleHeight = null;
            }

            if (node.type === "asl/router") {
                if (def.key === "truthy_label" && node.outputs?.[0]) node.outputs[0].name = value || "true";
                if (def.key === "falsy_label" && node.outputs?.[1]) node.outputs[1].name = value || "false";
            }

            state.graph.setDirtyCanvas(true, true);
        });

        wrapper.appendChild(input);
        form.appendChild(wrapper);
    });

    fragment.appendChild(form);
    nodePropertiesContainer.appendChild(fragment);
}
