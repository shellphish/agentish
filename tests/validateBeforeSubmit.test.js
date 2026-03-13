/**
 * Tests for validateASLBeforeSubmit in ui.js
 *
 * Coverage:
 *  - Entry node extra state variables required
 *  - System prompts non-empty for LLM / Router / Worker
 *  - structured_output_schema (array) non-empty for LLM
 *  - input_state_keys non-empty (except entry-connected LLM)
 *  - LLM fanout <= 1 other LLM
 *  - Router route descriptions non-empty
 */

import { jest } from '@jest/globals';

// ── Mock state so ui.js can be imported ──────────────────────────────────────
const mockState = { graph: { serialize: jest.fn() }, appState: { schema: {} } };

await jest.unstable_mockModule('../frontend/js/state.js', () => ({ state: mockState }));
await jest.unstable_mockModule('../frontend/js/utils.js', () => ({
    showToast: jest.fn(),
    downloadFile: jest.fn(),
    normalizeSchemaToLowercase: x => x,
    renderStateSchemaDisplay: jest.fn(),
    updateSummary: jest.fn()
}));
await jest.unstable_mockModule('../frontend/js/constants.js', () => ({
    NODE_TYPE_MAP: {},
    ASL_DEBUG: false
}));
await jest.unstable_mockModule('../frontend/js/nodes.js', () => ({
    ensureSingleEntry: jest.fn(),
    createNode: jest.fn()
}));
await jest.unstable_mockModule('../frontend/js/inspector.js', () => ({
    renderInspector: jest.fn(),
    renderEmptyInspector: jest.fn()
}));
await jest.unstable_mockModule('../frontend/js/serialization.js', () => ({
    serializeToASL: jest.fn(),
    serializeToLayout: jest.fn(),
    configureFromASL: jest.fn(),
    downloadASL: jest.fn(),
    downloadLayout: jest.fn(),
    viewASL: jest.fn(),
    cleanStaleStateVariables: jest.fn()
}));

const { validateASLBeforeSubmit } = await import('../frontend/js/ui.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal serialized graph with:
 * - One Entry node (id=1) with custom state vars
 * - One LLM node (id=2, entry-connected) with full config
 * - One link connecting entry → LLM: [linkId, fromId, fromSlot, toId, toSlot]
 */
function makeMinimalSerializedGraph(overrides = {}) {
    return {
        nodes: [
            {
                id: 1,
                type: 'asl/entry',
                title: 'Entry',
                properties: {
                    title: 'Entry',
                    initial_state: { task: 'str' }  // one custom var beyond count/messages
                },
                outputs: [{ links: [10] }]
            },
            {
                id: 2,
                type: 'asl/llm',
                title: 'Analyzer',
                properties: {
                    title: 'Analyzer',
                    system_prompt: 'You are an analyzer.',
                    input_state_keys: [],   // exempt: entry-connected
                    structured_output_schema: [{ name: 'result', type: 'str', description: 'r' }]
                },
                outputs: []
            }
        ],
        links: [
            [10, 1, 0, 2, 0]  // [id, fromNodeId, fromSlot, toNodeId, toSlot]
        ],
        ...overrides
    };
}

beforeEach(() => {
    mockState.graph.serialize.mockReturnValue(makeMinimalSerializedGraph());
});

// ── Entry state variables ─────────────────────────────────────────────────────

describe('Entry state variables', () => {
    test('entry with only default vars (count, messages) → error', () => {
        mockState.graph.serialize.mockReturnValue(makeMinimalSerializedGraph({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { count: 'int', messages: 'list' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'Analyzer',
                    properties: {
                        title: 'Analyzer', system_prompt: 'You are helpful.',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                }
            ]
        }));
        const { valid, errors } = validateASLBeforeSubmit();
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('at least one additional variable'))).toBe(true);
    });

    test('entry with a custom var → no state variable error', () => {
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('at least one additional variable'))).toBe(false);
    });
});

// ── System prompts ────────────────────────────────────────────────────────────

describe('System prompts', () => {
    test('LLM with empty system_prompt → error', () => {
        mockState.graph.serialize.mockReturnValue(makeMinimalSerializedGraph({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'Analyzer',
                    properties: {
                        title: 'Analyzer', system_prompt: '',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                }
            ]
        }));
        const { valid, errors } = validateASLBeforeSubmit();
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('System Message cannot be empty'))).toBe(true);
    });

    test('Router with empty system_prompt → error', () => {
        mockState.graph.serialize.mockReturnValue({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'LLM',
                    properties: {
                        title: 'LLM', system_prompt: 'You help.',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                },
                {
                    id: 3, type: 'asl/router', title: 'Router',
                    properties: {
                        title: 'Router', system_prompt: '',
                        input_state_keys: ['task'],
                        router_values: []
                    },
                    outputs: []
                }
            ],
            links: [[10, 1, 0, 2, 0]]
        });
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('System Message cannot be empty'))).toBe(true);
    });

    test('Worker with empty system_prompt → error', () => {
        mockState.graph.serialize.mockReturnValue({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'LLM',
                    properties: {
                        title: 'LLM', system_prompt: 'You help.',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                },
                {
                    id: 3, type: 'asl/worker', title: 'Worker',
                    properties: { title: 'Worker', system_prompt: '' },
                    outputs: []
                }
            ],
            links: [[10, 1, 0, 2, 0]]
        });
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('System Message cannot be empty'))).toBe(true);
    });
});

// ── Output Schema ─────────────────────────────────────────────────────────────

describe('Output schema', () => {
    test('LLM with empty structured_output_schema array → error', () => {
        mockState.graph.serialize.mockReturnValue(makeMinimalSerializedGraph({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'Analyzer',
                    properties: {
                        title: 'Analyzer', system_prompt: 'You analyze.',
                        input_state_keys: [],
                        structured_output_schema: []   // empty array
                    },
                    outputs: []
                }
            ]
        }));
        const { valid, errors } = validateASLBeforeSubmit();
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('Output Schema cannot be empty'))).toBe(true);
    });

    test('LLM with null structured_output_schema → error', () => {
        mockState.graph.serialize.mockReturnValue(makeMinimalSerializedGraph({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'Analyzer',
                    properties: {
                        title: 'Analyzer', system_prompt: 'You analyze.',
                        input_state_keys: [],
                        structured_output_schema: null
                    },
                    outputs: []
                }
            ]
        }));
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('Output Schema cannot be empty'))).toBe(true);
    });

    test('LLM with non-empty structured_output_schema → no schema error', () => {
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('Output Schema cannot be empty'))).toBe(false);
    });
});

// ── input_state_keys ──────────────────────────────────────────────────────────

describe('input_state_keys', () => {
    test('entry-connected LLM with no input_state_keys → no error (exempt)', () => {
        // default mock: LLM id=2 is entry-connected (link [10,1,0,2,0]) and has input_state_keys:[]
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('Input State cannot be empty'))).toBe(false);
    });

    test('non-entry LLM with no input_state_keys → error', () => {
        mockState.graph.serialize.mockReturnValue({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'LLM1',
                    properties: {
                        title: 'LLM1', system_prompt: 'You help.',
                        input_state_keys: [],  // exempt: entry-connected
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: [{ links: [20] }]
                },
                {
                    id: 3, type: 'asl/llm', title: 'LLM2',
                    properties: {
                        title: 'LLM2', system_prompt: 'You also help.',
                        input_state_keys: [],  // NOT exempt
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                }
            ],
            links: [[10, 1, 0, 2, 0], [20, 2, 0, 3, 0]]
        });
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('Input State cannot be empty'))).toBe(true);
    });
});

// ── LLM fanout ────────────────────────────────────────────────────────────────

describe('LLM fanout', () => {
    test('LLM connected to 2 other LLMs → error', () => {
        mockState.graph.serialize.mockReturnValue({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'LLM1',
                    properties: {
                        title: 'LLM1', system_prompt: 'You help.',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: [{ links: [20, 21] }]
                },
                {
                    id: 3, type: 'asl/llm', title: 'LLM2',
                    properties: {
                        title: 'LLM2', system_prompt: 'You help too.',
                        input_state_keys: ['task'],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                },
                {
                    id: 4, type: 'asl/llm', title: 'LLM3',
                    properties: {
                        title: 'LLM3', system_prompt: 'You also help.',
                        input_state_keys: ['task'],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                }
            ],
            links: [
                [10, 1, 0, 2, 0],
                [20, 2, 0, 3, 0],
                [21, 2, 0, 4, 0]
            ]
        });
        const { valid, errors } = validateASLBeforeSubmit();
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('at most 1 other LLM node'))).toBe(true);
    });

    test('LLM connected to exactly 1 other LLM → no fanout error', () => {
        // default mock has LLM2 with no outputs (terminal) — no fanout
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('at most 1 other LLM node'))).toBe(false);
    });
});

// ── Router descriptions ───────────────────────────────────────────────────────

describe('Router descriptions', () => {
    test('router_value with empty description → error', () => {
        mockState.graph.serialize.mockReturnValue({
            nodes: [
                {
                    id: 1, type: 'asl/entry', title: 'Entry',
                    properties: { title: 'Entry', initial_state: { task: 'str' } },
                    outputs: [{ links: [10] }]
                },
                {
                    id: 2, type: 'asl/llm', title: 'LLM',
                    properties: {
                        title: 'LLM', system_prompt: 'You help.',
                        input_state_keys: [],
                        structured_output_schema: [{ name: 'r', type: 'str', description: 'r' }]
                    },
                    outputs: []
                },
                {
                    id: 3, type: 'asl/router', title: 'Router',
                    properties: {
                        title: 'Router', system_prompt: 'Route it.',
                        input_state_keys: ['task'],
                        router_values: [
                            { node: 'A', description: 'Good description' },
                            { node: 'B', description: '' }  // missing
                        ]
                    },
                    outputs: []
                }
            ],
            links: [[10, 1, 0, 2, 0]]
        });
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('missing descriptions'))).toBe(true);
    });

    test('all router descriptions filled → no description error', () => {
        const { errors } = validateASLBeforeSubmit();
        expect(errors.some(e => e.includes('missing descriptions'))).toBe(false);
    });
});

// ── All-clear ─────────────────────────────────────────────────────────────────

describe('Valid graph passes all checks', () => {
    test('minimal valid graph → valid=true and no errors', () => {
        const { valid, errors } = validateASLBeforeSubmit();
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
    });
});
