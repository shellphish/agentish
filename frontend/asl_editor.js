const DEFAULT_SCHEMA = {
    count: "int",
    messages: "Annotated[List[BaseMessage], lambda x, y: x + y]"
};

// Default LLM configuration - Ollama llama3.1 with temperature 0
const DEFAULT_LLM_CONFIG = {
    model: "llama3.1:latest",
    temperature: 0.0
};

const DEFAULT_TOOL_MAX_ITERATIONS = 30;
const DEFAULT_TOOL_LIMIT_WARNING = "You are close to the tool iteration limit. Wrap up soon without more tool calls.";

const TOOL_TEMPLATE_ADDITION = `def tool_implementation(a: int, b: int, state: dict = None) -> dict:
    """
    Add two numbers together.
    
    Args:
        a: First number
        b: Second number
        state: Agent state (optional, read-only access)
    
    Returns:
        dict with result and success flag
    """
    try:
        result = a + b
        return {
            "result": result,
            "success": True
        }
    except Exception as e:
        return {
            "result": None,
            "success": False,
            "error": str(e)
        }`;

const NODE_FORMS = {
    "asl/entry": [
        { key: "title", label: "Display name", type: "text", placeholder: "Entry Node" },
        {
            key: "initial_state",
            label: "Initial state (JSON)",
            type: "json",
            rows: 4,
            description: "Additional state fields to initialize (count and messages are automatic)."
        }
    ],
    "asl/llm": [
        { key: "title", label: "Node title", type: "text", placeholder: "LLM Node", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "input_state_keys",
            label: "Input State",
            type: "state_checkboxes",
            description: "Input State to provide in context"
        },
        {
            key: "output_state_keys",
            label: "Global state to update",
            type: "state_checkboxes",
            description: "Select which state variables to update with LLM output"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "Prepended system instruction specific to this LLM node."
        },
        {
            key: "human_prompt",
            label: "Human prompt",
            type: "textarea",
            rows: 4,
            description: "Optional human message template evaluated before invoking the LLM."
        },
        {
            key: "structured_output_schema",
            label: "Output Schema",
            type: "output_schema_table",
            description: "Define the structure for LLM output"
        },
        {
            key: "selected_tools",
            label: "Selected tools",
            type: "list",
            placeholder: "Drag functions from catalog",
            description: "Tools that this LLM can use"
        },
        {
            key: "max_tool_iterations",
            label: "Max tool iterations",
            type: "number",
            placeholder: "30",
            description: "Maximum number of tool calls allowed (only shown when tools are selected)",
            min: 1,
            step: 1,
            conditional: { field: "selected_tools", hasItems: true }
        },
        {
            key: "iteration_warning_message",
            label: "Iteration warning message",
            type: "textarea",
            rows: 3,
            description: "Warning message when approaching tool iteration limit (only shown when tools are selected)",
            conditional: { field: "selected_tools", hasItems: true }
        }
    ],
    "asl/worker": [
        { key: "title", label: "Node title", type: "text", placeholder: "Worker Node", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "description",
            label: "Description",
            type: "textarea",
            rows: 2,
            description: "Brief description of this worker's purpose"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "System instruction for this worker node."
        },
        {
            key: "structured_output_schema",
            label: "JSON Schema",
            type: "output_schema_table",
            description: "Define the structure for LLM output"
        },
        {
            key: "selected_tools",
            label: "Selected tools",
            type: "list",
            placeholder: "Drag functions from catalog",
            description: "Tools that this worker can use"
        },
        {
            key: "max_tool_iterations",
            label: "Max tool iterations",
            type: "number",
            placeholder: "30",
            description: "Maximum number of tool calls allowed (only shown when tools are selected)",
            min: 1,
            step: 1,
            conditional: { field: "selected_tools", hasItems: true }
        },
        {
            key: "iteration_warning_message",
            label: "Iteration warning message",
            type: "textarea",
            rows: 3,
            description: "Warning message when approaching tool iteration limit (only shown when tools are selected)",
            conditional: { field: "selected_tools", hasItems: true }
        }
    ],
    "asl/router": [
        { key: "title", label: "Node title", type: "text", placeholder: "Router Block", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "input_state_keys",
            label: "Input State",
            type: "state_checkboxes",
            description: "Input State to provide in context"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "System instruction for routing decisions."
        },
        {
            key: "router_values",
            label: "Router Values",
            type: "router_values_table",
            description: "Define descriptions for each routing option"
        }
    ]
};

const NODE_FORM_KEYS = Object.fromEntries(
    Object.entries(NODE_FORMS).map(([type, defs]) => [
        type,
        new Set(defs.map((def) => def.key))
    ])
);

const NODE_TYPE_MAP = {
    entry: "asl/entry",
    llm: "asl/llm",
    router: "asl/router",
    worker: "asl/worker"
};

const EXPORT_TYPE_MAP = {
    "asl/entry": "EntryPoint",
    "asl/llm": "LLMNode",
    "asl/router": "RouterBlock",
    "asl/worker": "WorkerNode"
};

const IMPORT_TYPE_MAP = Object.fromEntries(
    Object.entries(EXPORT_TYPE_MAP).map(([litegraphType, exportType]) => [exportType, litegraphType])
);

console.log("=== ASL Editor Loading ===");

function patchConnectionArrows() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslArrowPatched) {
        return;
    }
    const proto = LGraphCanvas.prototype;
    const originalRenderLink = proto.renderLink;
    proto.renderLink = function(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, num_sublines) {
        const hadArrows = this.render_connection_arrows;
        if (hadArrows) {
            this.render_connection_arrows = false;
        }
        originalRenderLink.call(this, ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, num_sublines);
        if (hadArrows) {
            this.render_connection_arrows = hadArrows;
            if (this.ds.scale >= 0.6 && this.highquality_render && end_dir !== LiteGraph.CENTER) {
                const arrowColor =
                    color ||
                    (link && (link.color || LGraphCanvas.link_type_colors[link.type])) ||
                    this.default_link_color;
                const tip = this.computeConnectionPoint(a, b, 0.98, start_dir, end_dir);
                const prev = this.computeConnectionPoint(a, b, 0.93, start_dir, end_dir);
                const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
                ctx.save();
                ctx.translate(tip[0], tip[1]);
                ctx.rotate(angle);
                ctx.fillStyle = arrowColor;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-10, 5);
                ctx.lineTo(-10, -5);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        }
    };
    proto._aslArrowPatched = true;
}

function patchNodeRendering() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslNodePatched) {
        return;
    }
    
    // Store accent colors for each node type
    const nodeAccents = {
        'asl/entry': '#3B82F6',    // Blue
        'asl/llm': '#F59E0B',       // Orange
        'asl/router': '#A855F7',    // Purple
        'asl/worker': '#10B981'     // Green
    };
    
    const proto = LGraphCanvas.prototype;
    const originalDrawNode = proto.drawNode;
    const originalDrawNodeShape = proto.drawNodeShape;
    
    // Helper function to calculate wrapped lines and required height
    function calculateWrappedTitle(ctx, node, maxWidth) {
        // Use properties.title if available, otherwise fall back to node.title
        const title = node.properties?.title || node.title;
        if (!title) return { lines: [], height: LiteGraph.NODE_TITLE_HEIGHT };
        
        ctx.save();
        ctx.font = "bold 14px Arial";
        
        const words = title.split(" ");
        const lines = [];
        let currentLine = "";
        
        words.forEach((word) => {
            const testLine = currentLine ? currentLine + " " + word : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });
        if (currentLine) lines.push(currentLine);
        
        ctx.restore();
        
        const lineHeight = 16;
        const requiredHeight = Math.max(LiteGraph.NODE_TITLE_HEIGHT, lines.length * lineHeight + 8);
        
        return { lines, height: requiredHeight };
    }

    function drawWrappedTitle(ctx, canvas, node) {
        if (!node._wrappedTitleLines || node._wrappedTitleLines.length === 0) {
            return;
        }
        const titleHeight = node._titleHeight || LiteGraph.NODE_TITLE_HEIGHT;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, -titleHeight, node.size[0], titleHeight);
        ctx.clip();
        ctx.font = "bold 14px Arial";
        const textColor = node.is_selected
            ? LiteGraph.NODE_SELECTED_TITLE_COLOR
            : (node.constructor.title_text_color || canvas.node_title_color || "#ffffff");
        ctx.fillStyle = textColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        let y = -titleHeight + 8;
        const lineHeight = 16;
        node._wrappedTitleLines.forEach((line) => {
            ctx.fillText(line, 10, y);
            y += lineHeight;
        });
        ctx.restore();
    }
    
    // Override drawNodeShape to handle dynamic title height and render wrapped titles ourselves
    proto.drawNodeShape = function(node, ctx, size, fgcolor, bgcolor, selected, mouse_over) {
        const maxWidth = node.size[0] - 20;
        const titleData = calculateWrappedTitle(ctx, node, maxWidth);
        const title_height = titleData.height;

        node._wrappedTitleLines = titleData.lines;
        node._titleHeight = title_height;

        const originalTitleHeight = LiteGraph.NODE_TITLE_HEIGHT;
        const originalTitle = node.title;
        const hasOwnCtorTitle = node.constructor ? Object.prototype.hasOwnProperty.call(node.constructor, "title") : false;
        const originalCtorTitle = node.constructor ? node.constructor.title : undefined;
        const hasOwnGetTitle = Object.prototype.hasOwnProperty.call(node, "getTitle");
        const originalGetTitle = node.getTitle;

        // Suppress LiteGraph's default title rendering by clearing the sources it uses.
        node.title = "";
        if (node.constructor) {
            node.constructor.title = "";
        }
        node.getTitle = () => "";

        LiteGraph.NODE_TITLE_HEIGHT = title_height;

        originalDrawNodeShape.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouse_over);

        drawWrappedTitle(ctx, this, node);

        LiteGraph.NODE_TITLE_HEIGHT = originalTitleHeight;
        node.title = originalTitle;
        if (node.constructor) {
            if (hasOwnCtorTitle) {
                node.constructor.title = originalCtorTitle;
            } else {
                delete node.constructor.title;
            }
        }
        if (hasOwnGetTitle) {
            node.getTitle = originalGetTitle;
        } else {
            delete node.getTitle;
        }
    };
    
    proto.drawNode = function(node, ctx) {
        const accentColor = nodeAccents[node.type];
        
        if (accentColor) {
            // Temporarily override colors to use dark theme
            const originalColor = node.color;
            const originalBgcolor = node.bgcolor;
            
            // Force dark colors for rendering
            node.color = '#1E293B';  // Dark header
            node.bgcolor = '#1E293B';  // Dark body
            
            // Call original draw
            originalDrawNode.call(this, node, ctx);
            
            // Restore original colors
            node.color = originalColor;
            node.bgcolor = originalBgcolor;
        } else {
            // Default rendering for unknown types
            originalDrawNode.call(this, node, ctx);
        }
    };
    
    proto._aslNodePatched = true;
}

function initializeEditor() {
    console.log("=== Initializing Editor ===");
    console.log("LiteGraph available:", typeof LiteGraph !== 'undefined');
    console.log("LGraph available:", typeof LGraph !== 'undefined');
    console.log("LGraphCanvas available:", typeof LGraphCanvas !== 'undefined');
    
    if (typeof LiteGraph === 'undefined' || typeof LGraph === 'undefined' || typeof LGraphCanvas === 'undefined') {
        console.error("LiteGraph libraries not loaded. They should be loaded from CDN.");
        alert("Failed to load LiteGraph library. Please check your internet connection and refresh the page.");
        return;
    }

    patchConnectionArrows();
    patchNodeRendering();
    
    try {
        console.log("Creating LGraph...");
        const graph = new LGraph();
        console.log("Graph created:", graph);
        
        console.log("Creating LGraphCanvas...");
        const canvas = new LGraphCanvas("#main-canvas", graph);
        console.log("Canvas created:", canvas);
        
        // Ensure canvas is sized properly
        canvas.resize();

    // Canvas interaction configuration (be explicit)
    canvas.ds.scale = 0.85;
    canvas.background_image = null;
    canvas.grid = 24;
    canvas.read_only = false;
    canvas.allow_interaction = true;
    canvas.allow_dragnodes = true;
    canvas.allow_dragcanvas = true;  // Enable canvas dragging (middle-mouse or space+drag)
    canvas.allow_reconnect_links = true;
    canvas.live_mode = false;  // Ensure we're not in live mode
    // Disable the search box on double-click
    canvas.allow_searchbox = false;
    // Disable debug info rendering (the blue line at bottom left)
    // canvas.render_canvas_border = false;
    // canvas.render_info = false;
    
    // Ensure connections are visible
    canvas.render_connections_border = true;
    canvas.render_connection_arrows = true;
    canvas.connections_width = 3;
    
    // Track space key for canvas panning
    let spacePressed = false;
    let copiedNode = null;
    
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && e.target === document.body) {
            spacePressed = true;
            e.preventDefault();
        }
        
        // Skip if typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        
        // Ctrl+C: Copy selected node
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selectedNodes = Object.values(canvas.selected_nodes || {});
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
                // Copy properties
                newNode.properties = JSON.parse(JSON.stringify(copiedNode.properties));
                newNode.title = copiedNode.title;
                newNode.size = [...copiedNode.size];
                
                // Position offset from original
                newNode.pos = [copiedNode.pos[0] + 30, copiedNode.pos[1] + 30];
                
                graph.add(newNode);
                ensureSingleEntry(newNode);
                canvas.selectNode(newNode);
                updateSummary();
                showToast("Node cloned", "success");
                e.preventDefault();
            }
        }
        
        // Backspace or Delete: Remove selected node
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const selectedNodes = Object.values(canvas.selected_nodes || {});
            if (selectedNodes.length > 0) {
                selectedNodes.forEach(node => {
                    graph.remove(node);
                });
                canvas.selected_nodes = {};
                updateSummary();
                renderEmptyInspector();
                showToast("Node(s) deleted", "success");
                e.preventDefault();
            }
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            spacePressed = false;
        }
    });
    
    // Note: Canvas dragging is now enabled by default with middle-mouse button
    // LiteGraph handles this natively when allow_dragcanvas = true
    // Note: Canvas dragging is now enabled by default with middle-mouse button
    // LiteGraph handles this natively when allow_dragcanvas = true

    const nodePropertiesContainer = document.getElementById("node-properties");
    const stateSchemaTextarea = document.getElementById("state-schema");
    const applyStateBtn = document.getElementById("apply-state");
    const fileInput = document.getElementById("file-input");
    const summaryEl = document.getElementById("graph-summary");

    // Canvas controls (removed from UI)
    // const zoomInBtn = document.getElementById("zoom-in");
    // const zoomOutBtn = document.getElementById("zoom-out");
    // const resetZoomBtn = document.getElementById("reset-zoom");
    // const fitCanvasBtn = document.getElementById("fit-canvas");
    // const snapToggle = document.getElementById("snap-toggle");

    let appState = {
        schemaRaw: JSON.stringify(DEFAULT_SCHEMA, null, 2),
        schema: DEFAULT_SCHEMA,
        entrypointId: null
    };

    let globalTools = {
        // Example MCP tool (can be pre-populated)
    };

    stateSchemaTextarea.value = appState.schemaRaw;

    function showToast(message, variant = "info") {
        const tag = variant.toUpperCase();
        console.log(`[${tag}] ${message}`);
    }

    function inferTypeFromSchema(schemaValue) {
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

    function normalizeNodeProperties(node) {
        node.properties = node.properties || {};
        if (node.type === "asl/entry") {
            delete node.properties.system_prompt;
        }
        if (node.type === "asl/llm" || node.type === "asl/worker") {
            delete node.properties.model;
            delete node.properties.temperature;
            delete node.properties.tools;
            node.properties.output_key = node.properties.output_key || "llm_output";
            if (typeof node.properties.system_prompt !== "string") {
                node.properties.system_prompt = "";
            }
            if (typeof node.properties.human_prompt !== "string") {
                node.properties.human_prompt = "";
            }
            // Initialize structured output properties
            if (typeof node.properties.structured_output_enabled !== "boolean") {
                node.properties.structured_output_enabled = true;
            }
            if (!node.properties.structured_output_schema) {
                node.properties.structured_output_schema = [];
            }
            // Initialize tool properties
            if (!Array.isArray(node.properties.selected_tools)) {
                node.properties.selected_tools = [];
            }
            // Only set tool iteration properties if tools are present
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
        
        // Sync title property to display title
        if (node.properties.title) {
            node.title = node.properties.title;
        }
    }

    function updateSummary() {
        if (!summaryEl) return;
        const nodes = graph._nodes || [];
        const nodeCount = nodes.length;
        const edgeCount = graph.links ? Object.keys(graph.links).length : 0;
        const entryNode = nodes.find((node) => node.type === "asl/entry");
        const entryDesc = entryNode ? `#${entryNode.id}` : "unset";
        summaryEl.querySelectorAll("dd")[0].textContent = nodeCount.toString();
        summaryEl.querySelectorAll("dd")[1].textContent = edgeCount.toString();
        summaryEl.querySelectorAll("dd")[2].textContent = entryDesc;
    }

    // ---------------------- Node Definitions ----------------------
    function EntryPointNode() {
        this.title = "Entry Node";
        this.size = [220, 80];
        this.color = "#334155";  // Subtle border
        this.bgcolor = "#1E293B";  // Dark slate body
        this.resizable = false;
        this.properties = {
            title: "Entry Node",
            initial_state: {}
        };
        this.addOutput("next", "flow");  // Only outgoing
        this.widgets_up = true;
        this.serialize_widgets = true;
        
        // Draw blue top border accent
        this.onDrawForeground = function(ctx) {
            ctx.fillStyle = "#3B82F6";  // Blue accent
            ctx.fillRect(0, 0, this.size[0], 3);
        };
        
        // Debug: log when output is clicked
        this.onOutputClick = function(slot_index, e) {
            console.log("Entry Node output clicked:", slot_index);
        };
    }
    EntryPointNode.title = "Entry Node";
    EntryPointNode.title_color = "#000000";

    function LLMNode() {
        this.title = "LLM Node";
        this.size = [220, 140];
        this.color = "#334155";  // Subtle border
        this.bgcolor = "#1E293B";  // Dark slate body
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
        // Start with one input slot
        this.addInput("in", "flow");
        this.addOutput("out", "flow");
        this.widgets_up = true;
        this.serialize_widgets = true;
        
        // Auto-expand inputs when connections are made
        this.onConnectionsChange = function(type, slot, isConnected, link_info, slot_info) {
            if (type === LiteGraph.INPUT && isConnected) {
                // When an input is connected, check if we need to add another empty slot
                const hasEmptySlot = this.inputs.some(input => !input.link);
                if (!hasEmptySlot) {
                    const newSlotIndex = this.inputs.length;
                    const slotName = newSlotIndex === 0 ? "in" : `in${newSlotIndex + 1}`;
                    this.addInput(slotName, "flow");
                    if (graph) {
                        graph.setDirtyCanvas(true, true);
                    }
                }
            } else if (type === LiteGraph.INPUT && !isConnected) {
                // When disconnected, remove trailing empty slots (keep at least one)
                while (this.inputs.length > 1) {
                    const lastInput = this.inputs[this.inputs.length - 1];
                    if (!lastInput.link) {
                        this.removeInput(this.inputs.length - 1);
                    } else {
                        break;
                    }
                }
                if (graph) {
                    graph.setDirtyCanvas(true, true);
                }
            }
        };
        
        // Render selected tools on the node
        const renderSelectedTools = (ctx) => {
            const tools = this.properties.selected_tools || [];
            if (tools.length === 0) return;
            
            ctx.save();
            ctx.fillStyle = "#94A3B8";  // Muted text color
            ctx.font = "11px 'Inter', sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const text = tools.length ? `🔧 ${tools.join(", ")}` : "";
            const maxWidth = this.size[0] - 16;
            const words = text.split(" ");
            const lines = [];
            let current = "";
            words.forEach((word) => {
                const tentative = current ? current + " " + word : word;
                if (ctx.measureText(tentative).width > maxWidth) {
                    if (current) {
                        lines.push(current);
                    }
                    current = word;
                } else {
                    current = tentative;
                }
            });
            if (current) {
                lines.push(current);
            }
            let offsetY = this.size[1] - 35;
            lines.forEach((line) => {
                ctx.fillText(line, 8, offsetY);
                offsetY += 13;
            });
            ctx.restore();
        };

        this.onDrawForeground = function(ctx) {
            // Draw orange top border accent
            ctx.fillStyle = "#F59E0B";  // Orange accent
            ctx.fillRect(0, 0, this.size[0], 3);
            renderSelectedTools(ctx);
        };

        this._addTool = (toolName) => {
            this.properties.selected_tools = this.properties.selected_tools || [];
            if (this.properties.selected_tools.includes(toolName)) {
                showToast(`Tool "${toolName}" already added`, "info");
                return true;
            }
            if (!globalTools[toolName]) {
                showToast(`Tool "${toolName}" is not defined`, "error");
                return false;
            }
            this.properties.selected_tools.push(toolName);
            // Resize node to accommodate tools display
            const minHeight = 120;
            const toolsHeight = Math.ceil(this.properties.selected_tools.length / 2) * 15;
            this.size[1] = Math.max(minHeight, minHeight + toolsHeight);
            graph.setDirtyCanvas(true, true);
            if (canvas.selected_nodes && canvas.selected_nodes[this.id]) {
                renderInspector(this);
            }
            showToast(`Added tool "${toolName}"`, "success");
            return true;
        };

        // Add drop zone for tools
        this.onDropItem = function(event) {
            const toolName = event?.dataTransfer?.getData("tool-name");
            if (!toolName) {
                return false;
            }
            return this._addTool(toolName);
        };
    }
    LLMNode.title = "LLM Node";
    LLMNode.title_color = "#000000";

    function RouterBlockNode(){
        this.title = "Router Block";
        this.size = [220, 100]
        this.color = "#334155";  // Subtle border
        this.bgcolor = "#1E293B";  // Dark slate body
        this.properties = {
            title: "Router Block",
            input_state_keys: [],
            router_values: [],
            // router node should get system node from the user, and should be forwarded LLM response, as user prompt, and based on that it decides which path to take.
            system_prompt: "",
        };
        this.addInput("in", "flow");  // Only from LLM
        // it can have multiple output edges based on LLM nodes connected to it.
        this.addOutput("out", "flow");
        this.widgets_up = true;
        this.serialize_widgets = true;
        
        // Auto-sync router values when connections change
        this.onConnectionsChange = function(type, slot, isConnected, link_info, slot_info) {
            if (type === LiteGraph.OUTPUT) {
                // Sync router_values with current connections
                syncRouterValues(this);
                // Re-render inspector if this router is selected
                if (canvas && canvas.selected_nodes && canvas.selected_nodes[this.id]) {
                    renderInspector(this);
                }
            }
        };
        
        // Draw purple top border accent
        this.onDrawForeground = function(ctx) {
            ctx.fillStyle = "#A855F7";  // Purple accent
            ctx.fillRect(0, 0, this.size[0], 3);
        };
    }
    RouterBlockNode.title = "Router Block";
    RouterBlockNode.title_color = "#000000";

    function WorkerNode() {
        this.title = "Worker Node";
        this.size = [220, 120];
        this.color = "#334155";  // Subtle border
        this.bgcolor = "#1E293B";  // Dark slate body
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
        // Worker has input only, no output
        this.addInput("in", "flow");
        this.widgets_up = true;
        this.serialize_widgets = true;
        
        // Render selected tools on the node
        const renderSelectedTools = (ctx) => {
            const tools = this.properties.selected_tools || [];
            if (tools.length === 0) return;
            
            ctx.save();
            ctx.fillStyle = "#94A3B8";  // Muted text color
            ctx.font = "11px 'Inter', sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const text = tools.length ? `🔧 ${tools.join(", ")}` : "";
            const maxWidth = this.size[0] - 16;
            const words = text.split(" ");
            const lines = [];
            let current = "";
            words.forEach((word) => {
                const tentative = current ? current + " " + word : word;
                if (ctx.measureText(tentative).width > maxWidth) {
                    if (current) {
                        lines.push(current);
                    }
                    current = word;
                } else {
                    current = tentative;
                }
            });
            if (current) {
                lines.push(current);
            }
            let offsetY = this.size[1] - 35;
            lines.forEach((line) => {
                ctx.fillText(line, 8, offsetY);
                offsetY += 13;
            });
            ctx.restore();
        };

        this.onDrawForeground = function(ctx) {
            // Draw green top border accent
            ctx.fillStyle = "#10B981";  // Green accent
            ctx.fillRect(0, 0, this.size[0], 3);
            renderSelectedTools(ctx);
        };

        this._addTool = (toolName) => {
            this.properties.selected_tools = this.properties.selected_tools || [];
            if (this.properties.selected_tools.includes(toolName)) {
                showToast(`Tool "${toolName}" already added`, "info");
                return true;
            }
            if (!globalTools[toolName]) {
                showToast(`Tool "${toolName}" is not defined`, "error");
                return false;
            }
            this.properties.selected_tools.push(toolName);
            // Resize node to accommodate tools display
            const minHeight = 120;
            const toolsHeight = Math.ceil(this.properties.selected_tools.length / 2) * 15;
            this.size[1] = Math.max(minHeight, minHeight + toolsHeight);
            graph.setDirtyCanvas(true, true);
            if (canvas.selected_nodes && canvas.selected_nodes[this.id]) {
                renderInspector(this);
            }
            showToast(`Added tool "${toolName}"`, "success");
            return true;
        };

        // Add drop zone for tools
        this.onDropItem = function(event) {
            const toolName = event?.dataTransfer?.getData("tool-name");
            if (!toolName) {
                return false;
            }
            return this._addTool(toolName);
        };
    }
    WorkerNode.title = "Worker Node";
    WorkerNode.title_color = "#000000";

    // function ToolNode() {
    //     this.title = "Tool Node";
    //     this.size = [240, 110];
    //     this.color = "#33BBEE";
    //     this.bgcolor = "#33BBEE";
    //     this.properties = {
    //         title: "Tool Node",
    //         selected_tools: [],  // List of tool names
    //         max_tool_iterations: DEFAULT_TOOL_MAX_ITERATIONS,
    //         iteration_warning_message: DEFAULT_TOOL_LIMIT_WARNING
    //     };
    //     // ToolNode has INPUT from Conditional Block's "true" branch
    //     // NO output - automatically returns to the calling LLM node
    //     // The return path is inferred by both frontend and compiler
    //     this.addInput("in", "flow");
    //     this.widgets_up = true;
    //     this.serialize_widgets = true;
        
    //     const renderSelectedTools = (ctx) => {
    //         const tools = this.properties.selected_tools || [];
    //         ctx.save();
    //         ctx.fillStyle = "#000000";
    //         ctx.font = "12px 'Inter', sans-serif";
    //         ctx.textAlign = "left";
    //         ctx.textBaseline = "top";
    //         const text = tools.length ? tools.join(", ") : "Drop tools here";
    //         const maxWidth = this.size[0] - 16;
    //         const words = text.split(" ");
    //         const lines = [];
    //         let current = "";
    //         words.forEach((word) => {
    //             const tentative = current ? current + " " + word : word;
    //             if (ctx.measureText(tentative).width > maxWidth) {
    //                 if (current) {
    //                     lines.push(current);
    //                 }
    //                 current = word;
    //             } else {
    //                 current = tentative;
    //             }
    //         });
    //         if (current) {
    //             lines.push(current);
    //         }
    //         let offsetY = this.size[1] - 40;
    //         lines.forEach((line) => {
    //             ctx.fillText(line, 8, offsetY);
    //             offsetY += 14;
    //         });
    //         ctx.restore();
    //     };

    //     this.onDrawForeground = function(ctx) {
    //         renderSelectedTools(ctx);
    //     };

    //     this._addTool = (toolName) => {
    //         this.properties.selected_tools = this.properties.selected_tools || [];
    //         if (this.properties.selected_tools.includes(toolName)) {
    //             showToast(`Tool "${toolName}" already added`, "info");
    //             return true;
    //         }
    //         if (!globalTools[toolName]) {
    //             showToast(`Tool "${toolName}" is not defined`, "error");
    //             return false;
    //         }
    //         this.properties.selected_tools.push(toolName);
    //         graph.setDirtyCanvas(true, true);
    //         if (canvas.selected_nodes && canvas.selected_nodes[this.id]) {
    //             renderInspector(this);
    //         }
    //         showToast(`Added tool "${toolName}"`, "success");
    //         return true;
    //     };

    //     // Add drop zone for tools
    //     this.onDropItem = function(event) {
    //         const toolName = event?.dataTransfer?.getData("tool-name");
    //         if (!toolName) {
    //             return false;
    //         }
    //         return this._addTool(toolName);
    //     };
    // }
    // ToolNode.title = "Tool Node";
    // ToolNode.title_color = "#000000";

    LiteGraph.registerNodeType("asl/entry", EntryPointNode);
    LiteGraph.registerNodeType("asl/llm", LLMNode);
    LiteGraph.registerNodeType("asl/router", RouterBlockNode);
    LiteGraph.registerNodeType("asl/worker", WorkerNode);

    // ---------------------- Helper Functions ----------------------
    function ensureSingleEntry(node) {
        if (node.type !== "asl/entry") {
            return true;
        }
        const existing = graph._nodes.find((n) => n !== node && n.type === "asl/entry");
        if (existing) {
            showToast("Only one Entry Point is allowed.", "warning");
            graph.remove(node);
            return false;
        }
        appState.entrypointId = node.id;
        return true;
    }

    function randomCanvasPosition() {
        const viewport = canvas.viewport || [0, 0, canvas.canvas.width, canvas.canvas.height];
        const x = viewport[0] + viewport[2] / 2 + (Math.random() * 220 - 110);
        const y = viewport[1] + viewport[3] / 2 + (Math.random() * 160 - 80);
        return [x, y];
    }

    function createNode(kind) {
        console.log("createNode called with kind:", kind);
        const type = NODE_TYPE_MAP[kind];
        console.log("Mapped to type:", type);
        
        if (!type) {
            console.error("No type mapping found for:", kind);
            return;
        }
        
        console.log("Creating node with LiteGraph.createNode...");
        const node = LiteGraph.createNode(type);
        console.log("Node created:", node);
        
        if (!node) {
            console.error("LiteGraph.createNode returned null/undefined");
            return;
        }
        
        // Debug node structure
        console.log("Node details:");
        console.log("  title:", node.title);
        console.log("  type:", node.type);
        console.log("  size:", node.size);
        console.log("  inputs:", node.inputs);
        console.log("  outputs:", node.outputs);
        console.log("  flags:", node.flags);
        console.log("  Has getConnectionPos?", typeof node.getConnectionPos);
        
        node.pos = randomCanvasPosition();
        console.log("Node position set to:", node.pos);
        
        graph.add(node);
        console.log("Node added to graph");
        
        // Test getConnectionPos after adding to graph
        if (node.outputs && node.outputs.length > 0) {
            const pos = node.getConnectionPos(false, 0);
            console.log("Output slot 0 position:", pos);
        }
        
        ensureSingleEntry(node);
        canvas.selectNode(node);
        updateSummary();
        console.log("Node creation complete!");
    }

    function renderEmptyInspector() {
        nodePropertiesContainer.classList.add("empty-state");
        nodePropertiesContainer.innerHTML = `
            <strong>No node selected.</strong>
            <p>Select a block to configure prompts, routing, and memory.</p>
        `;
    }

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
            graph.setDirtyCanvas(true, true);
            // Re-render inspector if this is the selected_tools field for LLM nodes
            // This ensures conditional fields (max_tool_iterations) show/hide correctly
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

    function renderOutputSchemaTable(def, node, wrapper) {
        const TYPE_OPTIONS = [
            'str', 'int', 'float', 'bool', 'Any',
            'List[str]', 'List[int]', 'List[float]', 'List[dict]',
            'Dict[str, str]', 'Dict[str, int]', 'Dict[str, Any]',
            'Optional[str]', 'Optional[int]', 'Optional[dict]'
        ];

        const schemaArray = node.properties[def.key] || [];
        
        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'output-schema-table-container';
        
        // Create table
        const table = document.createElement('table');
        table.className = 'output-schema-table';
        
        // Table header
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
        
        // Table body
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
                    newSchema.push({
                        name: name,
                        type: type,
                        description: description
                    });
                }
            });
            
            node.properties[def.key] = newSchema;
            graph.setDirtyCanvas(true, true);
            
            // Validate empty schema
            if (newSchema.length === 0) {
                showToast("Output Schema cannot be empty", "error");
            }
        }
        
        function createRow(field = null) {
            const tr = document.createElement('tr');
            
            // Variable Name column
            const tdName = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'field-name-input';
            nameInput.value = field?.name || '';
            nameInput.placeholder = 'field_name';
            nameInput.addEventListener('input', () => {
                validateUniqueNames();
                updateNodeProperty();
            });
            nameInput.addEventListener('blur', () => {
                validateUniqueNames();
            });
            tdName.appendChild(nameInput);
            tr.appendChild(tdName);
            
            // Type column
            const tdType = document.createElement('td');
            const typeSelect = document.createElement('select');
            typeSelect.className = 'field-type-select';
            TYPE_OPTIONS.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (field && field.type === type) {
                    option.selected = true;
                }
                typeSelect.appendChild(option);
            });
            typeSelect.addEventListener('change', updateNodeProperty);
            tdType.appendChild(typeSelect);
            tr.appendChild(tdType);
            
            // Description column
            const tdDesc = document.createElement('td');
            const descInput = document.createElement('input');
            descInput.type = 'text';
            descInput.className = 'field-desc-input';
            descInput.value = field?.description || '';
            descInput.placeholder = 'Description (required)';
            descInput.addEventListener('input', updateNodeProperty);
            tdDesc.appendChild(descInput);
            tr.appendChild(tdDesc);
            
            // Delete button column
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
                
                // Uncheck global state checkbox if this field was from there
                if (field?.name) {
                    const checkboxes = document.querySelectorAll('.checkbox-item input[type="checkbox"]');
                    checkboxes.forEach(cb => {
                        if (cb.value === field.name) {
                            cb.checked = false;
                        }
                    });
                }
            });
            tdAction.appendChild(deleteBtn);
            tr.appendChild(tdAction);
            
            return tr;
        }
        
        function renderRows() {
            tbody.innerHTML = '';
            schemaArray.forEach(field => {
                tbody.appendChild(createRow(field));
            });
        }
        
        // Add field button
        const addFieldBtn = document.createElement('button');
        addFieldBtn.type = 'button';
        addFieldBtn.className = 'btn-add-field';
        addFieldBtn.textContent = '+ Add Field';
        addFieldBtn.addEventListener('click', () => {
            const newRow = createRow();
            tbody.appendChild(newRow);
            // Focus on the name input
            newRow.querySelector('.field-name-input').focus();
        });
        
        // Expose addRow function for checkbox sync
        tableContainer.addSchemaRow = function(fieldName, fieldType = 'str', fieldDesc = '') {
            // Check if field already exists
            const existingRows = tbody.querySelectorAll('tr');
            for (let row of existingRows) {
                const nameInput = row.querySelector('.field-name-input');
                if (nameInput && nameInput.value === fieldName) {
                    return; // Already exists, don't add
                }
            }
            
            const newRow = createRow({
                name: fieldName,
                type: fieldType,
                description: fieldDesc
            });
            tbody.appendChild(newRow);
            updateNodeProperty();
            validateUniqueNames();
        };
        
        // Expose removeRow function for checkbox sync
        tableContainer.removeSchemaRow = function(fieldName) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const nameInput = row.querySelector('.field-name-input');
                if (nameInput && nameInput.value === fieldName) {
                    row.remove();
                }
            });
            updateNodeProperty();
            validateUniqueNames();
        };
        
        // Initial render
        renderRows();
        validateUniqueNames();
        
        tableContainer.appendChild(table);
        tableContainer.appendChild(addFieldBtn);
        wrapper.appendChild(tableContainer);
    }

    function getConnectedNodesForRouter(node) {
        /**
         * Get list of nodes connected to this router's outputs
         * Returns array of {id, name} objects
         */
        const connectedNodes = [];
        if (!node.outputs) return connectedNodes;
        
        node.outputs.forEach(output => {
            if (!output.links) return;
            output.links.forEach(linkId => {
                const link = graph.links[linkId];
                if (!link) return;
                const targetNode = graph._nodes_by_id[link.target_id];
                if (targetNode && targetNode.properties && targetNode.properties.title) {
                    // Check if not already added (avoid duplicates)
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

    function syncRouterValues(node) {
        /**
         * Sync router_values with currently connected nodes
         * Preserves existing descriptions, removes disconnected nodes, adds new ones
         */
        if (node.type !== "asl/router") return;
        
        const connectedNodes = getConnectedNodesForRouter(node);
        const existingValues = node.properties.router_values || [];
        const newValues = [];
        
        // Keep values for nodes that are still connected
        connectedNodes.forEach(connNode => {
            const existing = existingValues.find(v => v.node === connNode.name);
            if (existing) {
                // Preserve existing description
                newValues.push({
                    node: connNode.name,
                    description: existing.description
                });
            } else {
                // New connection, add with empty description
                newValues.push({
                    node: connNode.name,
                    description: ""
                });
            }
        });
        
        node.properties.router_values = newValues;
    }

    function renderRouterValuesTable(def, node, wrapper) {
        const routerValues = node.properties[def.key] || [];
        
        // Sync with current connections first
        syncRouterValues(node);
        const syncedValues = node.properties[def.key] || [];
        
        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'router-values-table-container';
        
        // Check if router has connections
        const connectedNodes = getConnectedNodesForRouter(node);
        
        if (connectedNodes.length === 0) {
            // Show helper message
            const helperMsg = document.createElement('p');
            helperMsg.className = 'router-values-helper';
            helperMsg.textContent = "Connect nodes from this router's output to define routing options";
            tableContainer.appendChild(helperMsg);
            wrapper.appendChild(tableContainer);
            return;
        }
        
        // Create table
        const table = document.createElement('table');
        table.className = 'router-values-table';
        
        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="width: 40%;">Node Name</th>
                <th>Description</th>
            </tr>
        `;
        table.appendChild(thead);
        
        // Table body
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
                    if (!desc) {
                        descInput.classList.add('input-error');
                        allValid = false;
                    } else {
                        descInput.classList.remove('input-error');
                    }
                }
            });
            
            if (!allValid) {
                showToast("All router values must have descriptions", "error");
            }
            
            return allValid;
        }
        
        function updateNodeProperty() {
            const rows = tbody.querySelectorAll('tr');
            const newValues = [];
            
            rows.forEach(row => {
                const nodeNameSpan = row.querySelector('.router-node-name');
                const descInput = row.querySelector('.router-desc-input');
                
                const nodeName = nodeNameSpan.textContent;
                const description = descInput.value.trim();
                
                newValues.push({
                    node: nodeName,
                    description: description
                });
            });
            
            node.properties[def.key] = newValues;
            graph.setDirtyCanvas(true, true);
        }
        
        function createRow(value) {
            const tr = document.createElement('tr');
            
            // Node Name column (read-only)
            const tdName = document.createElement('td');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'router-node-name';
            nameSpan.textContent = value.node;
            nameSpan.style.fontWeight = '600';
            nameSpan.style.fontFamily = 'var(--font-mono)';
            tdName.appendChild(nameSpan);
            tr.appendChild(tdName);
            
            // Description column (editable)
            const tdDesc = document.createElement('td');
            const descInput = document.createElement('input');
            descInput.type = 'text';
            descInput.className = 'router-desc-input';
            descInput.value = value.description || '';
            descInput.placeholder = 'Description (required)';
            descInput.addEventListener('input', () => {
                updateNodeProperty();
                if (descInput.value.trim()) {
                    descInput.classList.remove('input-error');
                }
            });
            descInput.addEventListener('blur', validateDescriptions);
            tdDesc.appendChild(descInput);
            tr.appendChild(tdDesc);
            
            return tr;
        }
        
        function renderRows() {
            tbody.innerHTML = '';
            syncedValues.forEach(value => {
                tbody.appendChild(createRow(value));
            });
        }
        
        // Initial render
        renderRows();
        validateDescriptions();
        
        tableContainer.appendChild(table);
        wrapper.appendChild(tableContainer);
    }

    function renderInspector(node) {
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
        
        // Prevent form submission on Enter key
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            return false;
        });

        const formDefs = NODE_FORMS[node.type] || [];
        formDefs.forEach((def) => {
            // Handle conditional rendering
            if (def.conditional) {
                if (def.conditional.field && def.conditional.value !== undefined) {
                    // Checkbox-based conditional
                    if (node.properties?.[def.conditional.field] !== def.conditional.value) {
                        return; // Skip this field
                    }
                } else if (def.conditional.field && def.conditional.hasItems) {
                    // Array-based conditional (show only if array has items)
                    const arr = node.properties?.[def.conditional.field];
                    if (!Array.isArray(arr) || arr.length === 0) {
                        return; // Skip this field
                    }
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

            if (def.type === "list") {
                renderListField(def, node, wrapper);
                form.appendChild(wrapper);
                return;
            }

            // Handle output_schema_table for LLM and Worker nodes
            if (def.type === "output_schema_table") {
                renderOutputSchemaTable(def, node, wrapper);
                form.appendChild(wrapper);
                return;
            }

            // Handle router_values_table for Router nodes
            if (def.type === "router_values_table") {
                renderRouterValuesTable(def, node, wrapper);
                form.appendChild(wrapper);
                return;
            }

            // Handle state_checkboxes for LLM Node output selection
            if (def.type === "state_checkboxes") {
                // Get current global schema (excluding count and messages)
                const stateVars = Object.keys(appState.schema || {})
                    .filter(key => key !== "count" && key !== "messages");
                
                if (stateVars.length === 0) {
                    const hint = document.createElement("small");
                    hint.textContent = "No additional state variables defined. Add them in Entry Node's Initial State.";
                    hint.style.color = "#94a3b8";
                    wrapper.appendChild(hint);
                } else {
                    const checkboxContainer = document.createElement("div");
                    checkboxContainer.className = "checkbox-group";
                    
                    // Get currently selected keys (backward compatibility with output_key)
                    let selectedKeys = node.properties?.[def.key] || [];
                    if (!Array.isArray(selectedKeys)) {
                        selectedKeys = node.properties?.output_key ? [node.properties.output_key] : [];
                    }
                    
                    stateVars.forEach(varName => {
                        const checkboxWrapper = document.createElement("label");
                        checkboxWrapper.className = "checkbox-item";
                        
                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.value = varName;
                        checkbox.checked = selectedKeys.includes(varName);
                        
                        checkbox.addEventListener("change", () => {
                            // Update selected keys array
                            let updated = node.properties.output_state_keys || [];
                            if (checkbox.checked) {
                                if (!updated.includes(varName)) {
                                    updated.push(varName);
                                }
                            } else {
                                updated = updated.filter(k => k !== varName);
                            }
                            node.properties.output_state_keys = updated;
                            
                            // Also update output_key for backward compatibility (use first selected)
                            node.properties.output_key = updated[0] || "";
                            
                            // Sync with Output Schema Table
                            const schemaTableContainer = document.querySelector('.output-schema-table-container');
                            if (schemaTableContainer) {
                                if (checkbox.checked) {
                                    // Add row to table
                                    const fieldType = inferTypeFromSchema(appState.schema[varName]) || 'str';
                                    schemaTableContainer.addSchemaRow(varName, fieldType, '');
                                } else {
                                    // Remove row from table
                                    schemaTableContainer.removeSchemaRow(varName);
                                }
                            }
                            
                            graph.setDirtyCanvas(true, true);
                        });
                        
                        const labelText = document.createElement("span");
                        labelText.textContent = varName;
                        
                        checkboxWrapper.appendChild(checkbox);
                        checkboxWrapper.appendChild(labelText);
                        checkboxContainer.appendChild(checkboxWrapper);
                    });
                    
                    wrapper.appendChild(checkboxContainer);
                }
                
                form.appendChild(wrapper);
                return;
            }

            switch (def.type) {
                case "textarea":
                case "code": {
                    input = document.createElement("textarea");
                    input.value = currentValue ?? "";
                    input.rows = def.rows || (def.type === "code" ? 10 : 4);
                    input.placeholder = def.placeholder || "";
                    input.spellcheck = false;
                    if (def.type === "code") {
                        input.classList.add("code-input");
                    }
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
                    if (typeof def.min === "number") {
                        input.min = def.min;
                    }
                    if (typeof def.max === "number") {
                        input.max = def.max;
                    }
                    if (typeof def.step === "number") {
                        input.step = def.step;
                    }
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
                    if (typeof def.min === "number" && normalized < def.min) {
                        normalized = def.min;
                    }
                    if (typeof def.max === "number" && normalized > def.max) {
                        normalized = def.max;
                    }
                    value = Math.trunc(normalized);
                    input.value = String(value);
                    input.classList.remove("input-error");
                }
                if (input.dataset.isJson === "true") {
                    try {
                        value = value ? JSON.parse(value) : def.type === "json" && def.key === "arguments" ? [] : {};
                        
                        // Special validation for Entry Node initial_state
                        if (node.type === "asl/entry" && def.key === "initial_state") {
                            if (value.hasOwnProperty("count")) {
                                delete value.count;
                                showToast("'count' is a reserved state variable and cannot be overridden", "error");
                            }
                            if (value.hasOwnProperty("messages")) {
                                delete value.messages;
                                showToast("'messages' is a reserved state variable and cannot be overridden", "error");
                            }
                            // Update the textarea to show cleaned JSON
                            input.value = JSON.stringify(value, null, 2);
                        }
                        
                        input.classList.remove("input-error");
                    } catch (err) {
                        input.classList.add("input-error");
                        showToast(`Invalid JSON for ${def.label}`, "error");
                        return;
                    }
                }
                node.properties[def.key] = value;

                // Special handling for Entry Node initial_state - auto-update global state schema
                if (node.type === "asl/entry" && def.key === "initial_state") {
                    // Merge initial_state with default schema
                    const mergedSchema = {
                        count: "int",
                        messages: "Annotated[List[BaseMessage], lambda x, y: x + y]",
                        ...value  // Spread additional state fields
                    };
                    
                    // Update global state schema
                    appState.schema = mergedSchema;
                    appState.schemaRaw = JSON.stringify(mergedSchema, null, 2);
                    stateSchemaTextarea.value = appState.schemaRaw;
                    
                    // Update graph extra
                    graph.extra = graph.extra || {};
                    graph.extra.stateSchema = mergedSchema;
                    
                    showToast("Global state schema updated", "success");
                }

                // Update node title in UI when title property changes
                if (def.key === "title") {
                    node.title = value || node.type;
                    // Clear cached wrapped lines to force recalculation
                    node._wrappedTitleLines = null;
                    node._titleHeight = null;
                }

                // Keep router socket labels updated.
                if (node.type === "asl/router") {
                    if (def.key === "truthy_label" && node.outputs?.[0]) {
                        node.outputs[0].name = value || "true";
                    }
                    if (def.key === "falsy_label" && node.outputs?.[1]) {
                        node.outputs[1].name = value || "false";
                    }
                }

                graph.setDirtyCanvas(true, true);
            });

            wrapper.appendChild(input);
            form.appendChild(wrapper);
        });

        fragment.appendChild(form);
        nodePropertiesContainer.appendChild(fragment);
    }

    canvas.onNodeSelected = (node) => {
        console.log("Node selected:", node.title, "- Press Delete or Backspace to remove");
        renderInspector(node);
    };

    canvas.onNodeDeselected = () => {
        console.log("Node deselected");
        renderEmptyInspector();
    };

    renderEmptyInspector();

    // ---------------------- Palette Buttons ----------------------
    console.log("Setting up palette buttons...");
    const blocks = document.querySelectorAll(".block");
    console.log("Found", blocks.length, "blocks");
    
    blocks.forEach((btn) => {
        btn.addEventListener("click", () => {
            const type = btn.dataset.nodeType;
            console.log("Button clicked! Node type:", type);
            createNode(type);
        });
        
        // Enable drag and drop
        btn.addEventListener("dragstart", (e) => {
            const type = btn.dataset.nodeType;
            e.dataTransfer.setData("nodeType", type);
            e.dataTransfer.effectAllowed = "copy";
        });
    });
    
    // Handle drop on canvas
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
                const rect = canvasElement.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                // Convert screen coordinates to graph coordinates
                const graphPos = canvas.convertEventToCanvasOffset(e);
                const type = NODE_TYPE_MAP[nodeType];
                if (type) {
                    const node = LiteGraph.createNode(type);
                    if (node) {
                        node.pos = [graphPos[0], graphPos[1]];
                        graph.add(node);
                        ensureSingleEntry(node);
                        canvas.selectNode(node);
                        updateSummary();
                        console.log("Node created via drag-drop at", graphPos);
                    }
                }
            }
        });
    }

    // ---------------------- State Schema ----------------------
    applyStateBtn.addEventListener("click", () => {
        try {
            const parsed = JSON.parse(stateSchemaTextarea.value || "{}");
            appState.schema = parsed;
            appState.schemaRaw = stateSchemaTextarea.value;
            graph.extra = graph.extra || {};
            graph.extra.stateSchema = parsed;
            showToast("State schema updated", "success");
        } catch (err) {
            showToast("State schema must be valid JSON", "error");
        }
    });

    // ---------------------- Canvas controls (removed from UI) ----------------------
    /*
    function setScale(newScale) {
        const clamped = Math.min(Math.max(newScale, 0.2), 2.5);
        canvas.ds.scale = clamped;
        canvas.draw(true, true);
    }

    zoomInBtn.addEventListener("click", () => setScale(canvas.ds.scale * 1.15));
    zoomOutBtn.addEventListener("click", () => setScale(canvas.ds.scale * 0.85));
    resetZoomBtn.addEventListener("click", () => {
        canvas.ds.scale = 0.85;
        canvas.ds.offset[0] = 0;
        canvas.ds.offset[1] = 0;
        canvas.draw(true, true);
    });

    fitCanvasBtn.addEventListener("click", () => {
        if (!graph._nodes.length) return;
        const bounds = graph._nodes.reduce(
            (acc, node) => {
                const [width, height] = node.size || [180, 90];
                const minX = Math.min(acc.minX, node.pos[0]);
                const minY = Math.min(acc.minY, node.pos[1]);
                const maxX = Math.max(acc.maxX, node.pos[0] + width);
                const maxY = Math.max(acc.maxY, node.pos[1] + height);
                return { minX, minY, maxX, maxY };
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        );

        const canvasWidth = canvas.canvas.width;
        const canvasHeight = canvas.canvas.height;
        const graphWidth = bounds.maxX - bounds.minX;
        const graphHeight = bounds.maxY - bounds.minY;
        if (graphWidth === 0 || graphHeight === 0) return;

        const scaleX = (canvasWidth * 0.6) / graphWidth;
        const scaleY = (canvasHeight * 0.6) / graphHeight;
        const scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 2.0);

        canvas.ds.scale = scale;
        canvas.ds.offset[0] = -bounds.minX * scale + (canvasWidth - graphWidth * scale) / 2;
        canvas.ds.offset[1] = -bounds.minY * scale + (canvasHeight - graphHeight * scale) / 2;
        canvas.draw(true, true);
    });

    snapToggle.addEventListener("change", () => {
        canvas.grid = snapToggle.checked ? 24 : 0;
        canvas.draw(true, true);
    });
    */

    // ---------------------- Serialization Helpers ----------------------
    function collectEdges(serializedGraph) {
        const edges = [];
        (serializedGraph.nodes || []).forEach((node) => {
            if (!node.outputs) return;
            node.outputs.forEach((output) => {
                if (!output.links) return;
                output.links.forEach((linkId) => {
                    const link = serializedGraph.links.find((l) => l.id === linkId) || graph.links[linkId];
                    if (!link) return;
                    const edge = {
                        from: String(node.id),
                        to: String(link.target_id),
                        target_slot: link.target_slot,
                        type: (node.type === "asl/router") ? "ConditionalEdge" : "NormalEdge"
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

    function deriveToolRegistry(nodes) {
        const registry = {};
        nodes
            .filter((node) => node.type === "ToolNode")
            .forEach((node) => {
                const config = node.config || {};
                if (!config.tool_name) return;
                registry[config.tool_name] = {
                    description: config.description || "",
                    arguments: config.arguments || [],
                    return_schema: config.return_schema || {},
                    pass_state_keys: config.pass_state_keys || []
                };
            });
        return registry;
    }

    function serializeToASL() {
        const serializedGraph = graph.serialize();
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
                state: {
                    schema: appState.schema
                },
                nodes: aslNodes,
                edges,
                tools: globalTools
            }
        };
    }

    function downloadFile(filename, content) {
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

    function configureFromASL(asl) {
        graph.clear();
        const { graph: graphData } = asl;
        appState.schema = graphData?.state?.schema || {};
        appState.schemaRaw = JSON.stringify(appState.schema, null, 2);
        stateSchemaTextarea.value = appState.schemaRaw;
        appState.entrypointId = null;

        // Load tools from graph
        globalTools = graphData?.tools || {};
        renderToolList();
        renderFunctionCatalog();  // Also update catalog

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
                node.properties.title = nodeInfo.label;  // Sync to properties
            }
            graph.add(node);
            idMap.set(String(nodeInfo.id), node);
            if (node.type === "asl/entry") {
                appState.entrypointId = node.id;
            }
        });

        // First pass: pre-expand input slots for LLM nodes based on target_slot requirements
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

        // Second pass: create connections
        (graphData.edges || []).forEach((edge) => {
            console.log(`Creating edge: ${edge.from} → ${edge.to} (type: ${edge.type}, condition: ${edge.condition}, implicit: ${edge.implicit}, target_slot: ${edge.target_slot})`);
            
            // Skip implicit edges (auto-generated tool returns)
            if (edge.implicit) {
                console.log(`Skipping implicit edge (will be auto-inferred)`);
                return;
            }
            
            const fromNode = idMap.get(String(edge.from));
            const toNode = idMap.get(String(edge.to));
            if (!fromNode || !toNode) {
                console.warn(`Edge skip - fromNode: ${!!fromNode}, toNode: ${!!toNode}`);
                return;
            }
            
            let outputIndex = 0;
            if (fromNode.type === "asl/router" && edge.condition) {
                console.log(`Router edge - looking for output "${edge.condition}"`);
                console.log(`Available outputs:`, fromNode.outputs);
                const targetName = edge.condition.toLowerCase();
                outputIndex = (fromNode.outputs || []).findIndex((output) => output.name?.toLowerCase() === targetName);
                console.log(`Output index for "${edge.condition}": ${outputIndex}`);
                if (outputIndex < 0) outputIndex = 0;
            }
            
            // Use target_slot from edge data, fallback to 0 for backward compatibility
            const targetSlot = edge.target_slot !== undefined ? edge.target_slot : 0;
            console.log(`Connecting: ${fromNode.title}[${outputIndex}] → ${toNode.title}[${targetSlot}]`);
            fromNode.connect(outputIndex, toNode, targetSlot);
        });

        updateSummary();
        showToast("ASL graph loaded", "success");
    }

    // =====================================================
    // TOOL REGISTRY MANAGEMENT
    // =====================================================

    function renderToolList() {
        const toolList = document.getElementById('tool-list');
        if (!toolList) return;
        
        toolList.innerHTML = '';
        
        if (Object.keys(globalTools).length === 0) {
            toolList.innerHTML = '<p style="color: #718096; font-size: 0.85em; padding: 10px;">No tools defined yet. Click "+ New Tool" to create one.</p>';
            return;
        }
        
        for (const [toolName, toolDef] of Object.entries(globalTools)) {
            const toolItem = document.createElement('div');
            toolItem.style.cssText = 'padding: 8px; margin-bottom: 8px; background: #f7fafc; border-radius: 6px; border-left: 3px solid #667eea;';
            
            const toolType = toolDef.type === 'custom' ? '⚙️' : '🔌';
            const typeLabel = toolDef.type === 'custom' ? 'Custom' : 'MCP';
            
            toolItem.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #2d3748;">${toolType} ${toolName}</div>
                        <div style="font-size: 0.8em; color: #718096; margin-top: 2px;">${toolDef.description || 'No description'}</div>
                        <div style="font-size: 0.75em; color: #a0aec0; margin-top: 2px;">${typeLabel}</div>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        ${toolDef.type === 'custom' ? `<button class="btn-tool-edit" data-tool="${toolName}" style="padding: 4px 8px; font-size: 0.75em; background: #4299e1; color: white; border: none; border-radius: 4px; cursor: pointer;">Edit</button>` : ''}
                        ${toolDef.type === 'custom' ? `<button class="btn-tool-delete" data-tool="${toolName}" style="padding: 4px 8px; font-size: 0.75em; background: #e53e3e; color: white; border: none; border-radius: 4px; cursor: pointer;">×</button>` : ''}
                    </div>
                </div>
            `;
            
            toolList.appendChild(toolItem);
        }
        
        // Add event listeners for edit/delete
        document.querySelectorAll('.btn-tool-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const toolName = e.target.dataset.tool;
                openToolEditor(toolName);
            });
        });
        
        document.querySelectorAll('.btn-tool-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const toolName = e.target.dataset.tool;
                if (confirm(`Delete tool "${toolName}"?`)) {
                    delete globalTools[toolName];
                    renderToolList();
                    renderFunctionCatalog();  // Also update catalog
                    showToast(`Tool "${toolName}" deleted`, "success");
                }
            });
        });
    }

    function openToolEditor(toolName = null) {
        const modal = document.getElementById('tool-editor-modal');
        const isEdit = toolName !== null;
        
        // Reset or populate form
        document.getElementById('tool-name').value = isEdit ? toolName : '';
        document.getElementById('tool-description').value = isEdit ? (globalTools[toolName].description || '') : '';
        document.getElementById('tool-return-schema').value = isEdit ? JSON.stringify(globalTools[toolName].return_schema || {}, null, 2) : '{"result": "Any", "success": "bool"}';
        document.getElementById('tool-implementation').value = isEdit ? (globalTools[toolName].implementation || '') : '';
        
        // Arguments
        const argsContainer = document.getElementById('tool-arguments');
        argsContainer.innerHTML = '';
        
        if (isEdit && globalTools[toolName].arguments) {
            globalTools[toolName].arguments.forEach(arg => {
                addArgumentRow(arg);
            });
        }
        
        // Disable name field if editing
        document.getElementById('tool-name').disabled = isEdit;
        
        modal.style.display = 'flex';
    }

    function closeToolEditor() {
        document.getElementById('tool-editor-modal').style.display = 'none';
        document.getElementById('tool-name').disabled = false;
    }

    function addArgumentRow(argData = null) {
        const argsContainer = document.getElementById('tool-arguments');
        const row = document.createElement('div');
        row.className = 'argument-row';
        row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';
        
        row.innerHTML = `
            <input type="text" class="arg-name" placeholder="arg_name" value="${argData?.name || ''}" style="flex: 1; padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;">
            <select class="arg-type" style="flex: 1; padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;">
                <option value="str" ${argData?.type === 'str' ? 'selected' : ''}>str</option>
                <option value="int" ${argData?.type === 'int' ? 'selected' : ''}>int</option>
                <option value="float" ${argData?.type === 'float' ? 'selected' : ''}>float</option>
                <option value="bool" ${argData?.type === 'bool' ? 'selected' : ''}>bool</option>
                <option value="dict" ${argData?.type === 'dict' ? 'selected' : ''}>dict</option>
                <option value="list" ${argData?.type === 'list' ? 'selected' : ''}>list</option>
                <option value="Any" ${argData?.type === 'Any' ? 'selected' : ''}>Any</option>
            </select>
            <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #2d3748;">
                <input type="checkbox" class="arg-required" ${argData?.required ? 'checked' : ''}>
                Required
            </label>
            <input type="text" class="arg-description" placeholder="Description" value="${argData?.description || ''}" style="flex: 2; padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;">
            <button type="button" class="btn-remove-arg" style="padding: 6px 10px; background: #e53e3e; color: white; border: none; border-radius: 4px; cursor: pointer;">×</button>
        `;
        
        row.querySelector('.btn-remove-arg').addEventListener('click', () => row.remove());
        argsContainer.appendChild(row);
    }

    function collectArguments() {
        const argRows = document.querySelectorAll('.argument-row');
        const args = [];
        
        argRows.forEach(row => {
            const name = row.querySelector('.arg-name').value.trim();
            if (name) {
                args.push({
                    name: name,
                    type: row.querySelector('.arg-type').value,
                    required: row.querySelector('.arg-required').checked,
                    description: row.querySelector('.arg-description').value.trim()
                });
            }
        });
        
        return args;
    }

    async function validateToolSyntax() {
        const code = document.getElementById('tool-implementation').value;
        const feedback = document.getElementById('syntax-feedback');
        
        if (!code.trim()) {
            feedback.style.display = 'block';
            feedback.style.background = '#fed7d7';
            feedback.style.color = '#c53030';
            feedback.textContent = 'No code to validate';
            return;
        }
        
        try {
            const response = await fetch('/validate_tool_syntax', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({code})
            });
            
            const result = await response.json();
            
            feedback.style.display = 'block';
            if (result.valid) {
                feedback.style.background = '#c6f6d5';
                feedback.style.color = '#22543d';
                feedback.textContent = '✅ Syntax valid!';
            } else {
                feedback.style.background = '#fed7d7';
                feedback.style.color = '#c53030';
                feedback.textContent = `❌ Syntax error: ${result.error}`;
            }
        } catch (err) {
            feedback.style.display = 'block';
            feedback.style.background = '#fed7d7';
            feedback.style.color = '#c53030';
            feedback.textContent = `❌ Validation failed: ${err.message}`;
        }
    }

    function saveToolDefinition() {
        const toolName = document.getElementById('tool-name').value.trim();
        const description = document.getElementById('tool-description').value.trim();
        const returnSchemaText = document.getElementById('tool-return-schema').value.trim();
        const implementation = document.getElementById('tool-implementation').value.trim();
        
        // Validate
        if (!toolName) {
            showToast('Tool name is required', 'error');
            return;
        }
        
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(toolName)) {
            showToast('Tool name must be a valid Python identifier', 'error');
            return;
        }
        
        if (!implementation) {
            showToast('Implementation code is required', 'error');
            return;
        }
        
        let returnSchema = {};
        try {
            returnSchema = returnSchemaText ? JSON.parse(returnSchemaText) : {};
        } catch (e) {
            showToast('Return schema must be valid JSON', 'error');
            return;
        }
        
        const args = collectArguments();
        
        // Save to global tools
        globalTools[toolName] = {
            type: 'custom',
            description: description,
            arguments: args,
            return_schema: returnSchema,
            implementation: implementation
        };
        
        renderToolList();
        renderFunctionCatalog();  // Also update catalog
        closeToolEditor();
        showToast(`Tool "${toolName}" saved successfully`, 'success');
    }

    // Initialize tool list on load
    renderToolList();
    
    // =====================================================
    // FUNCTION CATALOG (Drag-and-Drop)
    // =====================================================
    
    function renderFunctionCatalog() {
        const catalog = document.getElementById('function-catalog');
        if (!catalog) return;
        
        catalog.innerHTML = '';
        
        if (Object.keys(globalTools).length === 0) {
            catalog.innerHTML = '<p style="color: #718096; font-size: 0.85em; padding: 10px;">No functions yet. Create tools first.</p>';
            return;
        }
        
        for (const [toolName, toolDef] of Object.entries(globalTools)) {
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
            
            item.addEventListener('dragend', (e) => {
                item.style.opacity = '1';
            });
            
            catalog.appendChild(item);
        }
    }
    
    async function hydrateMcpTools() {
        try {
            const configResp = await fetch('/config.json', { cache: 'no-store' });
            if (!configResp.ok) {
                console.warn('[MCP] config.json unavailable');
                return;
            }
            const config = await configResp.json();
            if (!config.mcp_enabled || !config.mcp_tools_endpoint) {
                console.log('[MCP] Server not configured');
                return;
            }
            const toolsResp = await fetch(config.mcp_tools_endpoint, { cache: 'no-store' });
            if (!toolsResp.ok) {
                console.warn('[MCP] Tool endpoint returned', toolsResp.status);
                return;
            }
            const toolData = await toolsResp.json();
            if (!toolData.success) {
                console.warn('[MCP] Tool endpoint error:', toolData.error);
                return;
            }
            let imported = 0;
            (toolData.tools || []).forEach((tool) => {
                if (!tool?.name) return;
                if (globalTools[tool.name]) return;
                globalTools[tool.name] = {
                    ...tool,
                    type: tool.type || 'mcp'
                };
                imported += 1;
            });
            if (imported) {
                renderFunctionCatalog();
                showToast(`Loaded ${imported} MCP tool${imported === 1 ? '' : 's'}`, 'success');
            }
        } catch (err) {
            console.warn('[MCP] Failed to hydrate tools:', err);
        }
    }

    // Re-render catalog when tools change
    renderFunctionCatalog();
    hydrateMcpTools();

    // ---------------------- Dropdown Menu Management ----------------------
    // Toggle dropdown menus
    document.querySelectorAll('.dropdown-toggle').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = button.closest('.dropdown');
            const menu = dropdown.querySelector('.dropdown-menu');
            
            // Close other dropdowns
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            
            // Toggle current dropdown
            menu.classList.toggle('show');
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu.show').forEach(m => {
            m.classList.remove('show');
        });
    });

    // ---------------------- Helper Functions for Menu Actions ----------------------
    function downloadASL() {
        try {
            const asl = serializeToASL();
            downloadFile("asl_graph.json", JSON.stringify(asl, null, 2));
            showToast("ASL specification downloaded", "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    function downloadLayout() {
        try {
            const serialized = graph.serialize();
            const layoutPayload = {
                nodes: serialized.nodes || [],
                links: serialized.links || [],
                groups: serialized.groups || [],
                config: {
                    state_schema: appState.schema
                }
            };
            downloadFile("asl_layout.json", JSON.stringify(layoutPayload, null, 2));
            showToast("Layout downloaded", "success");
        } catch (err) {
            showToast(`Failed to download layout: ${err.message}`, "error");
        }
    }

    async function downloadCode() {
        try {
            const asl = serializeToASL();
            const response = await fetch('/submission/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(asl)
            });
            const contentType = response.headers.get('content-type') || '';
            if (!response.ok) {
                if (contentType.includes('application/json')) {
                    const data = await response.json().catch(() => null);
                    throw new Error(data?.error || `HTTP ${response.status}`);
                }
                const text = await response.text().catch(() => '');
                throw new Error(text || `HTTP ${response.status}`);
            }
            if (contentType.includes('application/json')) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || 'Server returned JSON instead of a downloadable file');
            }
            const blob = await response.blob();
            const disposition = response.headers.get('content-disposition') || '';
            let filename = 'asl_submission.py';
            const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
            if (match && match[1]) {
                filename = match[1];
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("Code downloaded", "success");
        } catch (err) {
            console.error("Download failed:", err);
            showToast(`Download failed: ${err.message}`, "error");
        }
    }

    async function downloadBundle() {
        try {
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library not loaded. Please refresh the page.');
            }

            showToast("Creating bundle...", "info");
            const zip = new JSZip();
            
            // Add ASL specification
            const asl = serializeToASL();
            zip.file('asl_spec.json', JSON.stringify(asl, null, 2));
            
            // Add layout
            const serialized = graph.serialize();
            const layoutPayload = {
                nodes: serialized.nodes || [],
                links: serialized.links || [],
                groups: serialized.groups || [],
                config: {
                    state_schema: appState.schema
                }
            };
            zip.file('layout.json', JSON.stringify(layoutPayload, null, 2));
            
            // Add compiled code
            const codeResponse = await fetch('/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(asl)
            });
            
            if (!codeResponse.ok) {
                throw new Error(`Failed to compile code: HTTP ${codeResponse.status}`);
            }
            
            const result = await codeResponse.json();
            if (!result.code) {
                throw new Error('No code returned from compiler');
            }
            zip.file('compiled_agent.py', result.code);
            
            // Add README
            const readme = `# Agent Bundle

This bundle contains:
- asl_spec.json: The ASL specification
- layout.json: The visual layout data
- compiled_agent.py: The compiled LangGraph agent

## Usage

1. Review the ASL specification in asl_spec.json
2. Run the agent with: python compiled_agent.py
3. Import the layout back into the editor using layout.json

Generated: ${new Date().toISOString()}
`;
            zip.file('README.md', readme);
            
            // Generate and download
            const blob = await zip.generateAsync({type: 'blob'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'agent_bundle.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast("Bundle downloaded", "success");
        } catch (err) {
            console.error("Bundle creation failed:", err);
            showToast(`Bundle failed: ${err.message}`, "error");
        }
    }

    function viewASL() {
        try {
            const asl = serializeToASL();
            const formatted = JSON.stringify(asl, null, 2);
            document.getElementById('asl-content').textContent = formatted;
            document.getElementById('asl-view-modal').style.display = 'flex';
        } catch (err) {
            showToast(`Failed to view ASL: ${err.message}`, "error");
        }
    }

    async function viewCode() {
        try {
            const asl = serializeToASL();
            const response = await fetch('/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(asl)
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type') || '';
                let errorMsg = `HTTP ${response.status}`;

                if (contentType.includes('application/json')) {
                    const errorData = await response.json().catch(() => null);
                    if (errorData && errorData.error) errorMsg = errorData.error;
                } else {
                    const text = await response.text().catch(() => '');
                    if (text) {
                        const snippet = text.replace(/\s+/g, ' ').slice(0, 400);
                        errorMsg += `: ${snippet}`;
                    }
                }

                if (response.status === 501) {
                    errorMsg += ' — Start the Flask backend with `python3 backend/server.py`';
                }

                document.getElementById('generated-code').textContent = `Compiler error:\n\n${errorMsg}`;
                document.getElementById('code-modal').style.display = 'flex';
                throw new Error(errorMsg);
            }

            const result = await response.json();

            if (result.code) {
                document.getElementById('generated-code').textContent = result.code;
                document.getElementById('code-modal').style.display = 'flex';
            } else {
                throw new Error('No code returned from compiler');
            }
        } catch (err) {
            showToast(`Failed to generate code: ${err.message}`, "error");
            console.error("Code generation error:", err);
        }
    }

    // ---------------------- Dropdown Menu Items ----------------------
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            
            // Close dropdown
            e.target.closest('.dropdown-menu').classList.remove('show');
            
            // Execute action
            switch(action) {
                // Import actions
                case 'import-asl':
                    document.getElementById('file-input-asl').click();
                    break;
                case 'import-layout':
                    document.getElementById('file-input-layout').click();
                    break;
                case 'import-bundle':
                    document.getElementById('file-input-bundle').click();
                    break;
                case 'import-auto':
                    document.getElementById('file-input').click();
                    break;
                // Download actions (merged from Export)
                case 'download-asl':
                    downloadASL();
                    break;
                case 'download-layout':
                    downloadLayout();
                    break;
                case 'download-code':
                    await downloadCode();
                    break;
                case 'download-bundle':
                    await downloadBundle();
                    break;
                // View actions
                case 'view-asl':
                    viewASL();
                    break;
                case 'view-code':
                    await viewCode();
                    break;
            }
        });
    });

    // ---------------------- Import Handlers ----------------------
    // Auto-detect import (original behavior)
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
                    graph.configure(data);
                    if (data.extra?.stateSchema) {
                        appState.schema = data.extra.stateSchema;
                        appState.schemaRaw = JSON.stringify(appState.schema, null, 2);
                        stateSchemaTextarea.value = appState.schemaRaw;
                    }
                    updateSummary();
                    showToast("Layout loaded", "success");
                }
            } catch (err) {
                showToast(`Failed to load file: ${err.message}`, "error");
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    });

    // Import ASL (strict format check)
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

    // Import Layout (strict format check)
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
                graph.configure(data);
                if (data.extra?.stateSchema) {
                    appState.schema = data.extra.stateSchema;
                    appState.schemaRaw = JSON.stringify(appState.schema, null, 2);
                    stateSchemaTextarea.value = appState.schemaRaw;
                }
                if (data.config?.state_schema) {
                    appState.schema = data.config.state_schema;
                    appState.schemaRaw = JSON.stringify(appState.schema, null, 2);
                    stateSchemaTextarea.value = appState.schemaRaw;
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

    // Import Bundle (extract from ZIP)
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
            
            // Try to find ASL spec first (preferred)
            let aslFile = contents.file("asl_spec.json") || contents.file("asl_graph.json");
            
            if (aslFile) {
                const aslContent = await aslFile.async("string");
                const data = JSON.parse(aslContent);
                configureFromASL(data);
                showToast("Bundle imported (ASL specification)", "success");
            } else {
                // Fall back to layout
                let layoutFile = contents.file("layout.json") || contents.file("asl_layout.json");
                
                if (layoutFile) {
                    const layoutContent = await layoutFile.async("string");
                    const data = JSON.parse(layoutContent);
                    graph.configure(data);
                    if (data.extra?.stateSchema || data.config?.state_schema) {
                        appState.schema = data.extra?.stateSchema || data.config?.state_schema;
                        appState.schemaRaw = JSON.stringify(appState.schema, null, 2);
                        stateSchemaTextarea.value = appState.schemaRaw;
                    }
                    updateSummary();
                    showToast("Bundle imported (Layout)", "success");
                } else {
                    throw new Error("Bundle does not contain asl_spec.json or layout.json");
                }
            }
            
        } catch (err) {
            showToast(`Failed to import bundle: ${err.message}`, "error");
            console.error("Bundle import error:", err);
        }
        
        event.target.value = '';
    });

    // Old handlers removed - now using dropdown menus
    // The following buttons no longer exist:
    // - load-btn (now Import dropdown menu)
    // - save-btn (removed)
    // - export-layout-btn (merged into Download menu)
    // - export-btn (merged into Download menu)
    // - download-btn (now in Download menu)
    // - view-code-btn (now in View menu)

    const submitModal = document.getElementById('submit-status-modal');
    const closeSubmitModalBtn = document.getElementById('close-submit-modal');
    const traceLinkWrapper = document.getElementById('trace-link-wrapper');
    const traceLink = document.getElementById('trace-link');
    let submissionJobId = null;
    let submissionPollTimer = null;

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
        const serializedGraph = graph.serialize();
        const nodes = serializedGraph.nodes || [];

        // Check Entry node has additional variables in initial_state
        const entryNode = nodes.find(node => node.type === "asl/entry");
        if (entryNode) {
            const initialState = entryNode.properties?.initial_state || {};
            const additionalVars = Object.keys(initialState).filter(
                key => key !== 'count' && key !== 'messages'
            );
            if (additionalVars.length === 0) {
                errors.push("Entry Node must have at least one additional variable in Initial State (beyond 'count' and 'messages')");
            }
        }

        // Check all Worker, LLM, and Router nodes
        nodes.forEach(node => {
            const nodeTitle = node.properties?.title || node.title || `Node ${node.id}`;
            
            // Check system_prompt for Worker, LLM, and Router nodes
            if (node.type === "asl/worker" || node.type === "asl/llm" || node.type === "asl/router") {
                const systemPrompt = node.properties?.system_prompt;
                if (!systemPrompt || systemPrompt.trim() === '') {
                    const nodeTypeName = node.type === "asl/worker" ? "Worker Node" : 
                                       node.type === "asl/llm" ? "LLM Node" : "Router Node";
                    errors.push(`${nodeTypeName} "${nodeTitle}": System Message cannot be empty`);
                }
            }

            // Check structured_output_schema for Worker and LLM nodes
            if (node.type === "asl/worker" || node.type === "asl/llm") {
                const schema = node.properties?.structured_output_schema;
                if (!schema || Object.keys(schema).length === 0) {
                    const nodeTypeName = node.type === "asl/worker" ? "Worker Node" : "LLM Node";
                    errors.push(`${nodeTypeName} "${nodeTitle}": Output Schema cannot be empty`);
                }
            }
        });

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    function resetSubmitModal() {
        submissionJobId = null;
        if (submissionPollTimer) {
            clearInterval(submissionPollTimer);
            submissionPollTimer = null;
        }
        submitModal.querySelectorAll('.submit-step').forEach(step => {
            setBadgeStatus(step, 'pending');
            const details = step.querySelector('.submit-step-details');
            if (details) details.textContent = '';
        });
        submitModal.querySelectorAll('.submit-substep').forEach(sub => {
            setBadgeStatus(sub, 'pending');
        });
        traceLinkWrapper.classList.add('hidden');
        traceLink.href = '#';
    }

    function openSubmitModal() {
        if (submitModal) {
            submitModal.classList.remove('hidden');
        }
    }

    function closeSubmitModal() {
        if (submitModal) {
            submitModal.classList.add('hidden');
            resetSubmitModal();
        }
    }

    closeSubmitModalBtn?.addEventListener('click', closeSubmitModal);
    submitModal?.addEventListener('click', (event) => {
        if (event.target === submitModal) {
            closeSubmitModal();
        }
    });

    function applyStepUpdate(stepKey, stepData) {
        if (!stepData) return;
        const stepEl = submitModal.querySelector(`.submit-step[data-step="${stepKey}"]`);
        if (stepEl) {
            setBadgeStatus(stepEl, stepData.status);
            const detailsEl = stepKey === 'execution'
                ? submitModal.querySelector('[data-field="execution-details"]')
                : stepEl.querySelector('.submit-step-details');
            if (detailsEl && stepData.details) {
                detailsEl.textContent = stepData.details;
            }
        }
    }

    function applySubstepUpdate(subKey, subData) {
        if (!subData) return;
        const subEl = submitModal.querySelector(`.submit-substep[data-substep="${subKey}"]`);
        if (subEl) {
            setBadgeStatus(subEl, subData.status);
            if (subData.details) {
                const badge = subEl.querySelector('.status-badge');
                badge.setAttribute('title', subData.details);
            }
        }
    }

    function renderSubmitStatus(job) {
        if (!job || !job.steps) return;
        applyStepUpdate('compile', job.steps.compile);
        applyStepUpdate('syntax', job.steps.syntax);
        applyStepUpdate('execution', job.steps.execution);

        if (job.steps.execution?.substeps) {
            const subs = job.steps.execution.substeps;
            applySubstepUpdate('prepare', subs.prepare);
            applySubstepUpdate('run', subs.run);
            applySubstepUpdate('langfuse', subs.langfuse);
        }

        if (job.steps.execution?.trace_url) {
            traceLinkWrapper.classList.remove('hidden');
            traceLink.href = job.steps.execution.trace_url;
        }

        if (job.status && (job.status === 'success' || job.status === 'error')) {
            if (submissionPollTimer) {
                clearInterval(submissionPollTimer);
                submissionPollTimer = null;
            }
            showToast(job.status === 'success' ? 'Sandbox execution succeeded' : 'Sandbox execution failed', job.status === 'success' ? 'success' : 'error');
        }
    }

    async function pollSubmission(jobId) {
        try {
            const resp = await fetch(`/submit/status/${jobId}`);
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const data = await resp.json();
            renderSubmitStatus(data);
            if (data.status === 'success' || data.status === 'error') {
                if (submissionPollTimer) {
                    clearInterval(submissionPollTimer);
                    submissionPollTimer = null;
                }
            }
        } catch (err) {
            console.warn('Failed to poll submission status:', err);
        }
    }

    document.getElementById("submit-btn").addEventListener("click", async () => {
        try {
            // First, perform ASL validation
            const validation = validateASLBeforeSubmit();
            
            // Open the submit modal to show validation status
            openSubmitModal();
            
            const aslCheckStep = submitModal.querySelector('.submit-step[data-step="asl_check"]');
            
            if (!validation.valid) {
                // Validation failed - show errors
                setBadgeStatus(aslCheckStep, 'error');
                const detailsEl = aslCheckStep.querySelector('.submit-step-details');
                if (detailsEl) {
                    detailsEl.textContent = validation.errors.join(' • ');
                }
                showToast('ASL Validation failed. Please fix the errors.', 'error');
                return; // Stop submission
            }
            
            // Validation passed
            setBadgeStatus(aslCheckStep, 'success');
            const detailsEl = aslCheckStep.querySelector('.submit-step-details');
            if (detailsEl) {
                detailsEl.textContent = 'All validations passed';
            }
            
            // Continue with normal submission
            const asl = serializeToASL();
            const response = await fetch('/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(asl)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            submissionJobId = data.job_id;
            renderSubmitStatus(data.job);
            showToast('Submission started', 'success');
            if (submissionPollTimer) {
                clearInterval(submissionPollTimer);
            }
            submissionPollTimer = setInterval(() => {
                if (submissionJobId) {
                    pollSubmission(submissionJobId);
                }
            }, 1500);
        } catch (err) {
            closeSubmitModal();
            showToast(`Submission failed: ${err.message}`, 'error');
            console.error('Submission error:', err);
        }
    });
    
    // Old view-code-btn handler removed - now using View menu dropdown
    
    // ---------------------- Modal Event Handlers ----------------------
    // Close code modal button
    document.getElementById("close-modal").addEventListener("click", () => {
        document.getElementById('code-modal').style.display = 'none';
    });
    
    // Download code button from modal
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
    
    // Close code modal when clicking outside
    document.getElementById('code-modal').addEventListener('click', (e) => {
        if (e.target.id === 'code-modal') {
            document.getElementById('code-modal').style.display = 'none';
        }
    });

    // ASL View Modal handlers
    document.getElementById("close-asl-modal").addEventListener("click", () => {
        document.getElementById('asl-view-modal').style.display = 'none';
    });

    document.getElementById("copy-asl-btn").addEventListener("click", () => {
        const content = document.getElementById('asl-content').textContent;
        navigator.clipboard.writeText(content).then(() => {
            showToast("ASL copied to clipboard", "success");
        }).catch(err => {
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

    // Close ASL modal when clicking outside
    document.getElementById('asl-view-modal').addEventListener('click', (e) => {
        if (e.target.id === 'asl-view-modal') {
            document.getElementById('asl-view-modal').style.display = 'none';
        }
    });

    // Tool Editor Event Handlers
    document.getElementById('new-tool-btn').addEventListener('click', () => openToolEditor());
    document.getElementById('close-tool-editor').addEventListener('click', closeToolEditor);
    document.getElementById('cancel-tool-btn').addEventListener('click', closeToolEditor);
    document.getElementById('save-tool-btn').addEventListener('click', saveToolDefinition);
    document.getElementById('add-argument-btn').addEventListener('click', () => addArgumentRow());
    document.getElementById('validate-syntax-btn').addEventListener('click', validateToolSyntax);

    // Template selector
    document.getElementById('template-selector').addEventListener('change', (e) => {
        if (e.target.value === 'addition') {
            document.getElementById('tool-implementation').value = TOOL_TEMPLATE_ADDITION;
            document.getElementById('tool-name').value = 'addition';
            document.getElementById('tool-description').value = 'Add two numbers together';
            document.getElementById('tool-return-schema').value = '{"result": "int", "success": "bool"}';
            
            // Clear and add arguments
            document.getElementById('tool-arguments').innerHTML = '';
            addArgumentRow({name: 'a', type: 'int', required: true, description: 'First number'});
            addArgumentRow({name: 'b', type: 'int', required: true, description: 'Second number'});
        }
    });

    // Update summary when graph mutates
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
            appState.entrypointId = null;
        }
        updateSummary();
    };

    const originalOnConnectionChange = graph.onConnectionChange;
    graph.onConnectionChange = function () {
        originalOnConnectionChange?.apply(graph, arguments);
        updateSummary();
    };

    LiteGraph.after_change = () => {
        updateSummary();
    };

    graph.start();
    updateSummary();
    
    // Handle window resize
    window.addEventListener('resize', () => {
        canvas.resize();
    });
    
    console.log("=== Initialization complete ===");
    } catch (error) {
        console.error("=== INITIALIZATION ERROR ===");
        console.error("Error:", error);
        console.error("Stack:", error.stack);
        alert("Failed to initialize ASL Editor. Check console for details.\nError: " + error.message);
    }
}

// Wait for window to fully load (including external scripts)
window.addEventListener('load', initializeEditor);
