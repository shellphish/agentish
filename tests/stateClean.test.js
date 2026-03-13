/**
 * Tests for cleanStaleStateVariables in serialization.js
 *
 * Key coverage:
 *  - input_state_keys and output_state_keys pruned when key removed from schema
 *  - structured_output_schema (NOT output_schema) entries pruned correctly
 *  - valid keys are preserved
 *  - nodes with no properties are skipped safely
 */

import { jest } from '@jest/globals';

// ── Shared mock state that tests can mutate ───────────────────────────────────
const mockState = {
    graph: { _nodes: [] },
    appState: { schema: {} },
    globalTools: {}
};

await jest.unstable_mockModule('../frontend/js/state.js', () => ({ state: mockState }));
await jest.unstable_mockModule('../frontend/js/utils.js', () => ({
    showToast: jest.fn(),
    downloadFile: jest.fn(),
    normalizeSchemaToLowercase: x => x,
    renderStateSchemaDisplay: jest.fn(),
    updateSummary: jest.fn(),
    randomCanvasPosition: () => [0, 0],
    isSafeKey: () => true
}));
await jest.unstable_mockModule('../frontend/js/constants.js', () => ({
    NODE_FORM_KEYS: {},
    EXPORT_TYPE_MAP: {},
    IMPORT_TYPE_MAP: {}
}));
await jest.unstable_mockModule('../frontend/js/nodes.js', () => ({
    normalizeNodeProperties: jest.fn()
}));
await jest.unstable_mockModule('../frontend/js/tools.js', () => ({
    renderToolList: jest.fn(),
    renderFunctionCatalog: jest.fn()
}));

const { cleanStaleStateVariables } = await import('../frontend/js/serialization.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSchema(keys) {
    mockState.appState.schema = Object.fromEntries(keys.map(k => [k, 'str']));
}

function setNodes(nodes) {
    mockState.graph._nodes = nodes;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanStaleStateVariables — input_state_keys', () => {
    test('removes key no longer in schema', () => {
        setSchema(['task']);
        setNodes([{ properties: { input_state_keys: ['task', 'old_key'] } }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.input_state_keys).toEqual(['task']);
    });

    test('keeps all keys when all are valid', () => {
        setSchema(['task', 'result']);
        setNodes([{ properties: { input_state_keys: ['task', 'result'] } }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.input_state_keys).toEqual(['task', 'result']);
    });

    test('empties array when all keys are stale', () => {
        setSchema(['task']);
        setNodes([{ properties: { input_state_keys: ['old1', 'old2'] } }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.input_state_keys).toEqual([]);
    });
});

describe('cleanStaleStateVariables — output_state_keys', () => {
    test('removes stale key from output_state_keys', () => {
        setSchema(['result']);
        setNodes([{ properties: { output_state_keys: ['result', 'stale'] } }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.output_state_keys).toEqual(['result']);
    });
});

describe('cleanStaleStateVariables — structured_output_schema', () => {
    test('removes schema row whose name is stale', () => {
        setSchema(['result']);
        setNodes([{
            properties: {
                structured_output_schema: [
                    { name: 'result', type: 'str', description: 'The result' },
                    { name: 'old_field', type: 'str', description: 'Removed var' }
                ]
            }
        }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.structured_output_schema).toHaveLength(1);
        expect(mockState.graph._nodes[0].properties.structured_output_schema[0].name).toBe('result');
    });

    test('keeps all rows when all names are valid', () => {
        setSchema(['result', 'confidence']);
        setNodes([{
            properties: {
                structured_output_schema: [
                    { name: 'result', type: 'str', description: 'The result' },
                    { name: 'confidence', type: 'float', description: 'Score' }
                ]
            }
        }]);
        cleanStaleStateVariables();
        expect(mockState.graph._nodes[0].properties.structured_output_schema).toHaveLength(2);
    });

    test('does NOT touch a property called output_schema (wrong name — should be structured_output_schema)', () => {
        // This test ensures we fixed the bug: old code used output_schema, real property is structured_output_schema
        setSchema(['result']);
        const node = {
            properties: {
                output_schema: [{ name: 'stale', type: 'str', description: 'Should be ignored' }],
                structured_output_schema: [{ name: 'stale', type: 'str', description: 'Should be cleaned' }]
            }
        };
        setNodes([node]);
        cleanStaleStateVariables();
        // structured_output_schema cleaned (stale removed → empty)
        expect(node.properties.structured_output_schema).toHaveLength(0);
        // output_schema NOT touched (we don't manage that property)
        expect(node.properties.output_schema).toHaveLength(1);
    });
});

describe('cleanStaleStateVariables — edge cases', () => {
    test('node with no properties is skipped safely', () => {
        setSchema(['task']);
        setNodes([{ /* no properties */ }, { properties: { input_state_keys: ['task'] } }]);
        expect(() => cleanStaleStateVariables()).not.toThrow();
        expect(mockState.graph._nodes[1].properties.input_state_keys).toEqual(['task']);
    });

    test('empty graph nodes list is handled', () => {
        setSchema(['task']);
        setNodes([]);
        expect(() => cleanStaleStateVariables()).not.toThrow();
    });

    test('empty schema removes all keys', () => {
        setSchema([]);
        setNodes([{
            properties: {
                input_state_keys: ['task', 'result'],
                output_state_keys: ['result'],
                structured_output_schema: [{ name: 'result', type: 'str', description: 'r' }]
            }
        }]);
        cleanStaleStateVariables();
        const props = mockState.graph._nodes[0].properties;
        expect(props.input_state_keys).toEqual([]);
        expect(props.output_state_keys).toEqual([]);
        expect(props.structured_output_schema).toEqual([]);
    });
});
