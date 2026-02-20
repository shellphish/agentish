// =====================================================
// ASL Editor — Entry Point
// =====================================================
// This is the only file loaded by index.html.
// It bootstraps the graph/canvas, registers node types,
// renders initial UI, and delegates all event wiring
// to the specialised modules.

import { ASL_DEBUG } from './constants.js';
import { state } from './state.js';
import { renderStateSchemaDisplay, updateSummary } from './utils.js';
import { patchConnectionArrows, patchNodeRendering, patchContextMenu, patchCanvasGrid } from './litegraph-patches.js';
import { registerNodeTypes, ensureSingleEntry } from './nodes.js';
import { renderEmptyInspector, renderInspector } from './inspector.js';
import { renderToolList, renderFunctionCatalog, hydrateMcpTools } from './tools.js';
import { initUI } from './ui.js';

if (ASL_DEBUG) console.log("=== ASL Editor Loading ===");

function initializeEditor() {
    if (ASL_DEBUG) console.log("=== Initializing Editor ===");

    if (typeof LiteGraph === 'undefined' || typeof LGraph === 'undefined' || typeof LGraphCanvas === 'undefined') {
        console.error("LiteGraph libraries not loaded. They should be loaded from CDN.");
        alert("Failed to load LiteGraph library. Please check your internet connection and refresh the page.");
        return;
    }

    // Apply LiteGraph rendering patches
    patchConnectionArrows();
    patchNodeRendering();
    patchContextMenu();
    patchCanvasGrid();

    try {
        // ---- Create graph & canvas ----
        const graph = new LGraph();
        const canvas = new LGraphCanvas("#main-canvas", graph);

        // Store in shared state for all modules
        state.graph = graph;
        state.canvas = canvas;

        // ---- Canvas configuration ----
        canvas.resize();
        canvas.ds.scale = 0.85;
        canvas.background_image = null;
        canvas.grid = 24;
        canvas.read_only = false;
        canvas.allow_interaction = true;
        canvas.allow_dragnodes = true;
        canvas.allow_dragcanvas = true;
        canvas.allow_reconnect_links = true;
        canvas.live_mode = false;
        canvas.allow_searchbox = false;
        canvas.render_canvas_border = false;
        canvas.render_info = false;

        canvas.render_connections_border = true;
        canvas.render_connection_arrows = true;
        canvas.connections_width = 3;

        // ---- Register node types ----
        registerNodeTypes();

        // ---- Initial renders ----
        renderStateSchemaDisplay();
        renderEmptyInspector();
        renderToolList();
        renderFunctionCatalog();
        hydrateMcpTools();

        // ---- Canvas selection → Inspector ----
        canvas.onNodeSelected = (node) => renderInspector(node);
        canvas.onNodeDeselected = () => renderEmptyInspector();

        // ---- Wire all UI event listeners ----
        initUI();

        // ---- Graph mutation hooks ----
        const originalOnNodeAdded = graph.onNodeAdded;
        graph.onNodeAdded = function (node) {
            originalOnNodeAdded?.call(graph, node);
            ensureSingleEntry(node);
            updateSummary();
        };

        const originalOnNodeRemoved = graph.onNodeRemoved;
        graph.onNodeRemoved = function (node) {
            originalOnNodeRemoved?.call(graph, node);
            if (node.type === "asl/entry") {
                state.appState.entrypointId = null;
            }
            updateSummary();
        };

        const originalOnConnectionChange = graph.onConnectionChange;
        graph.onConnectionChange = function () {
            originalOnConnectionChange?.apply(graph, arguments);
            updateSummary();
        };

        LiteGraph.after_change = () => { updateSummary(); };

        // ---- Start ----
        graph.start();
        updateSummary();

        // ResizeObserver fires on initial observe (catching first layout)
        // and on every subsequent size change — keeps canvas pixel buffer
        // in sync with CSS display size so click coords match rendering.
        const ro = new ResizeObserver(() => { canvas.resize(); });
        ro.observe(document.getElementById('main-canvas'));

        if (ASL_DEBUG) console.log("=== Initialization complete ===");
    } catch (error) {
        if (ASL_DEBUG) console.error("=== INITIALIZATION ERROR ===");
        if (ASL_DEBUG) console.error("Error:", error);
        alert("Failed to initialize ASL Editor. Check console for details.\nError: " + error.message);
    }
}

window.addEventListener('load', initializeEditor);
