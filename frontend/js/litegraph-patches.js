// =====================================================
// ASL Editor — LiteGraph Rendering Patches
// =====================================================
// These monkey-patch LiteGraph prototypes for custom
// arrow rendering, dark-themed nodes, and disabled
// context menus. No internal module dependencies.

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

    proto.drawNodeShape = function (node, ctx, size, fgcolor, bgcolor, selected, mouse_over) {
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

        node.title = "";
        if (node.constructor) node.constructor.title = "";
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

    proto.drawNode = function (node, ctx) {
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
    proto.getCanvasMenuOptions = function () {
        return null;
    };

    proto._aslContextMenuPatched = true;
}
