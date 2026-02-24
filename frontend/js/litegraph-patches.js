// =====================================================
// ASL Editor — LiteGraph Rendering Patches
// =====================================================
// These monkey-patch LiteGraph prototypes for custom
// arrow rendering, dark-themed nodes, and disabled
// context menus.

import { formatSlotName } from './utils.js';

export function patchConnectionArrows() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslArrowPatched) {
        return;
    }
    const proto = LGraphCanvas.prototype;
    const originalRenderLink = proto.renderLink;
    proto.renderLink = function (ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, num_sublines) {
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

export function patchNodeRendering() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslNodePatched) {
        return;
    }

    const nodeAccents = {
        'asl/entry': '#3B82F6',
        'asl/llm': '#F59E0B',
        'asl/router': '#A855F7',
        'asl/worker': '#10B981'
    };

    const proto = LGraphCanvas.prototype;
    const originalDrawNode = proto.drawNode;
    const originalDrawNodeShape = proto.drawNodeShape;

    function calculateWrappedTitle(ctx, node, maxWidth) {
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

    // Left padding must clear the LiteGraph title-box circle
    // (centered at x = title_height/2, radius = 5).
    const TITLE_TEXT_LEFT = 26;

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
            ctx.fillText(line, TITLE_TEXT_LEFT, y);
            y += lineHeight;
        });
        ctx.restore();
    }

    proto.drawNodeShape = function (node, ctx, size, fgcolor, bgcolor, selected, mouse_over) {
        const maxWidth = node.size[0] - TITLE_TEXT_LEFT - 10;
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

        node.title = "";
        if (node.constructor) node.constructor.title = "";
        node.getTitle = () => "";

        LiteGraph.NODE_TITLE_HEIGHT = title_height;

        // Suppress built-in selection outline (has a 6px gap); we draw our own below
        originalDrawNodeShape.call(this, node, ctx, size, fgcolor, bgcolor, false, mouse_over);

        drawWrappedTitle(ctx, this, node);

        // Draw tight selection outline with no gap
        if (selected) {
            var shape = node._shape || node.constructor.shape || LiteGraph.ROUND_SHAPE;
            var area = [-1, -title_height - 1, size[0] + 2, size[1] + title_height + 2];
            if (node.onBounding) node.onBounding(area);
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            if (shape === LiteGraph.BOX_SHAPE) {
                ctx.rect(area[0], area[1], area[2], area[3]);
            } else if (shape === LiteGraph.ROUND_SHAPE || (shape === LiteGraph.CARD_SHAPE && node.flags.collapsed)) {
                ctx.roundRect(area[0], area[1], area[2], area[3], [this.round_radius]);
            } else if (shape === LiteGraph.CARD_SHAPE) {
                ctx.roundRect(area[0], area[1], area[2], area[3], [this.round_radius, this.round_radius, 0, 0]);
            } else if (shape === LiteGraph.CIRCLE_SHAPE) {
                ctx.arc(size[0] * 0.5, size[1] * 0.5, size[0] * 0.5 + 1, 0, Math.PI * 2);
            }
            ctx.strokeStyle = LiteGraph.NODE_BOX_OUTLINE_COLOR;
            ctx.stroke();
            ctx.strokeStyle = fgcolor;
            ctx.globalAlpha = 1;
        }

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

    proto.drawNode = function (node, ctx) {
        // Set display labels for slots
        if (node.inputs) {
            const count = node.inputs.length;
            for (let i = 0; i < count; i++) {
                node.inputs[i].label = formatSlotName(node.inputs[i].name, count);
            }
        }
        if (node.outputs) {
            const count = node.outputs.length;
            for (let i = 0; i < count; i++) {
                node.outputs[i].label = formatSlotName(node.outputs[i].name, count);
            }
        }

        const accentColor = nodeAccents[node.type];

        if (accentColor) {
            const originalColor = node.color;
            const originalBgcolor = node.bgcolor;

            node.color = '#1E293B';
            node.bgcolor = '#1E293B';

            originalDrawNode.call(this, node, ctx);

            node.color = originalColor;
            node.bgcolor = originalBgcolor;
        } else {
            originalDrawNode.call(this, node, ctx);
        }
    };

    proto._aslNodePatched = true;
}

export function patchContextMenu() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslContextMenuPatched) {
        return;
    }

    const proto = LGraphCanvas.prototype;

    // Disable canvas (background) right-click menu
    proto.getCanvasMenuOptions = function () {
        return null;
    };

    // Strip unwanted items from the node right-click menu
    const _hiddenItems = new Set(["Mode", "Pin", "Colors", "Shapes"]);
    const originalGetNodeMenuOptions = proto.getNodeMenuOptions;
    proto.getNodeMenuOptions = function (node) {
        const options = originalGetNodeMenuOptions.call(this, node);
        if (!Array.isArray(options)) return options;
        return options.filter(opt => {
            if (opt === null) return true;               // separators
            return !_hiddenItems.has(opt.content);
        });
    };

    proto._aslContextMenuPatched = true;
}

/**
 * Draws a subtle dot-grid on the canvas background so users have
 * spatial orientation even when zoomed/panned.
 */
export function patchCanvasGrid() {
    if (!window.LGraphCanvas || window.LGraphCanvas.prototype._aslGridPatched) {
        return;
    }

    const proto = LGraphCanvas.prototype;
    const originalDrawBackCanvas = proto.drawBackCanvas;

    proto.drawBackCanvas = function () {
        originalDrawBackCanvas.call(this);

        const ctx = this.bgcanvas.getContext('2d');
        if (!ctx) return;

        const scale = this.ds.scale;
        if (scale < 0.25) return; // skip when zoomed way out

        const spacing = 24;
        const offset = this.ds.offset;
        const w = this.bgcanvas.width;
        const h = this.bgcanvas.height;

        const startX = (offset[0] * scale) % (spacing * scale);
        const startY = (offset[1] * scale) % (spacing * scale);
        const step = spacing * scale;

        const dotSize = Math.max(0.6, scale * 0.8);
        const alpha = Math.min(0.3, scale * 0.25);

        ctx.save();
        ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`;

        for (let x = startX; x < w; x += step) {
            for (let y = startY; y < h; y += step) {
                ctx.beginPath();
                ctx.arc(x, y, dotSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    };

    proto._aslGridPatched = true;
}
