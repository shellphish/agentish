// =====================================================
// ASL Editor — Shared Mutable State
// =====================================================
// Every module reads/writes to this single object instead
// of relying on closure variables inside initializeEditor().

import { DEFAULT_SCHEMA } from './constants.js';

export const state = {
    /** @type {LGraph|null} */
    graph: null,

    /** @type {LGraphCanvas|null} */
    canvas: null,

    appState: {
        schemaRaw: JSON.stringify(DEFAULT_SCHEMA, null, 2),
        schema: { ...DEFAULT_SCHEMA },
        entrypointId: null
    },

    /** Tool definitions (custom + MCP) keyed by tool name */
    globalTools: {}
};
