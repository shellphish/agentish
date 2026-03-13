/**
 * Tests for _validateTopology (exported as validateTopology) in serialization.js
 *
 * Covers all checks in _validateTopology:
 *   Check 1  — Terminal LLM exists
 *   Check 2a — No orphan LLM/Router nodes
 *   Check 2b — Every Worker connected to an LLM
 *   Check 3  — Router fanout >= 2
 *   Check 4  — Entry connects to exactly 1 LLM
 *   Check 5  — Loop LLM nodes must declare loop_mode
 *   Check 6  — input_state_keys non-empty (except entry-connected LLM)
 *   Check 7  — Router descriptions non-empty
 *   Check 8  — LLM fanout <= 1 other LLM
 *   Cycle detection
 */

import { jest } from '@jest/globals';

// ── Mock all dependencies so serialization.js can be imported in isolation ──
await jest.unstable_mockModule('../frontend/js/state.js', () => ({
    state: { graph: {}, appState: { schema: {} }, globalTools: {} }
}));
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

const { validateTopology } = await import('../frontend/js/serialization.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function entryNode(id = '1') {
    return { id, type: 'EntryPoint', label: 'Entry', config: { title: 'Entry' } };
}
function llmNode(id, extra = {}) {
    return {
        id, type: 'LLMNode', label: `LLM${id}`,
        config: {
            title: `LLM${id}`,
            system_prompt: 'You are helpful.',
            input_state_keys: ['task'],
            structured_output_schema: [{ name: 'result', type: 'str', description: 'result' }],
            ...extra
        }
    };
}
function routerNode(id, routerValues = [], extra = {}) {
    return {
        id, type: 'RouterBlock', label: `Router${id}`,
        config: {
            title: `Router${id}`,
            system_prompt: 'Route the request.',
            input_state_keys: ['task'],
            router_values: routerValues,
            ...extra
        }
    };
}
function workerNode(id) {
    return {
        id, type: 'WorkerNode', label: `Worker${id}`,
        config: { title: `Worker${id}`, system_prompt: 'Do work.' }
    };
}
function edge(from, to, type = 'NormalEdge', condition = null) {
    const e = { from, to, type };
    if (condition) e.condition = condition;
    return e;
}
function routerValue(node, description = 'Route to this node.') {
    return { node, description };
}

/** Minimal valid graph: Entry(1) → LLM2 (terminal), schema has 'task' */
function validGraph() {
    return {
        graph: {
            entrypoint: '1',
            state: { schema: { task: 'str' } },
            nodes: [
                entryNode('1'),
                llmNode('2', { input_state_keys: [] }) // entry-connected: exempt
            ],
            edges: [edge('1', '2')]
        }
    };
}

// ── Check 4: Entry node ───────────────────────────────────────────────────────

describe('Check 4 — Entry node', () => {
    test('no entrypoint field → error', () => {
        const asl = validGraph();
        delete asl.graph.entrypoint;
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('No entry node'))).toBe(true);
    });

    test('entry has no outgoing edge → error', () => {
        const asl = validGraph();
        asl.graph.edges = [];
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no outgoing edge'))).toBe(true);
    });

    test('entry has 2 outgoing edges → error', () => {
        const asl = validGraph();
        asl.graph.nodes.push(llmNode('3'));
        asl.graph.edges.push(edge('1', '3'));
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('2 outgoing edges'))).toBe(true);
    });

    test('entry connects to Router (not LLM) → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    routerNode('2', [routerValue('A'), routerValue('B')]),
                    llmNode('3'),
                    llmNode('4')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('2', '4')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('connect directly to an LLM Node'))).toBe(true);
    });

    test('entry connects to exactly 1 LLM → no entry error', () => {
        const asl = validGraph();
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('Entry node'))).toBe(false);
    });
});

// ── Check 1: Terminal LLM ─────────────────────────────────────────────────────

describe('Check 1 — Terminal LLM', () => {
    test('all LLMs have outgoing edges → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2'), llmNode('3')],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('No terminal LLM node'))).toBe(true);
    });

    test('at least one terminal LLM → no error', () => {
        const asl = validGraph();
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('No terminal LLM node'))).toBe(false);
    });
});

// ── Check 2a: No orphan LLM/Router ───────────────────────────────────────────

describe('Check 2a — No orphan LLM/Router nodes', () => {
    test('LLM with no incoming edge → error', () => {
        const asl = validGraph();
        asl.graph.nodes.push(llmNode('3'));
        // Node 3 has no incoming edge
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no incoming flow edge'))).toBe(true);
    });

    test('Router with no incoming edge → error', () => {
        const asl = validGraph();
        asl.graph.nodes.push(routerNode('3', [routerValue('A'), routerValue('B')]));
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no incoming flow edge'))).toBe(true);
    });

    test('all LLM/Router nodes reachable → no orphan error', () => {
        const asl = validGraph();
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no incoming flow edge'))).toBe(false);
    });
});

// ── Check 2b: Workers connected ──────────────────────────────────────────────

describe('Check 2b — Worker nodes must be connected to an LLM', () => {
    test('Worker with no incoming edge → error', () => {
        const asl = validGraph();
        asl.graph.nodes.push(workerNode('3'));
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('not connected to any LLM node'))).toBe(true);
    });

    test('Worker connected to LLM → no error', () => {
        const asl = validGraph();
        asl.graph.nodes.push(workerNode('3'));
        asl.graph.edges.push(edge('2', '3')); // LLM2 → Worker3 (tool binding)
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('not connected to any LLM node'))).toBe(false);
    });
});

// ── Check 3: Router fanout ────────────────────────────────────────────────────

describe('Check 3 — Router fanout >= 2', () => {
    test('Router with 1 outgoing edge → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2', { input_state_keys: [] }), routerNode('3'), llmNode('4')],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('Routers must have at least 2'))).toBe(true);
    });

    test('Router with 0 outgoing edges → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2', { input_state_keys: [] }), routerNode('3')],
                edges: [edge('1', '2'), edge('2', '3')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('Routers must have at least 2'))).toBe(true);
    });

    test('Router with 2 outgoing edges → no fanout error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3'),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('Routers must have at least 2'))).toBe(false);
    });
});

// ── Check 8: LLM fanout <= 1 LLM ─────────────────────────────────────────────

describe('Check 8 — LLM fanout at most 1 other LLM', () => {
    test('LLM connects to 2 other LLMs → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2', { input_state_keys: [] }), llmNode('3'), llmNode('4')],
                edges: [edge('1', '2'), edge('2', '3'), edge('2', '4')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('at most 1 other LLM node'))).toBe(true);
    });

    test('LLM connects to exactly 1 other LLM → no error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2', { input_state_keys: [] }), llmNode('3')],
                edges: [edge('1', '2'), edge('2', '3')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('at most 1 other LLM node'))).toBe(false);
    });
});

// ── Check 6: input_state_keys ─────────────────────────────────────────────────

describe('Check 6 — input_state_keys non-empty (except entry-connected LLM)', () => {
    test('entry-connected LLM with no input_state_keys → no error (exempt)', () => {
        const asl = validGraph(); // LLM2 is entry-connected with input_state_keys: []
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no Input State selected'))).toBe(false);
    });

    test('non-entry LLM with no input_state_keys → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),     // entry-connected: exempt
                    llmNode('3', { input_state_keys: [] })      // NOT exempt
                ],
                edges: [edge('1', '2'), edge('2', '3')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no Input State selected'))).toBe(true);
    });

    test('Router with no input_state_keys → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L4', 'Go to L4'), routerValue('L5', 'Go to L5')], { input_state_keys: [] }),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no Input State selected'))).toBe(true);
    });

    test('non-entry LLM with input_state_keys set → no error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    llmNode('3', { input_state_keys: ['task'] })
                ],
                edges: [edge('1', '2'), edge('2', '3')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('no Input State selected'))).toBe(false);
    });
});

// ── Check 7: Router descriptions ─────────────────────────────────────────────

describe('Check 7 — Router route descriptions non-empty', () => {
    test('router_value with empty description → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L4', ''), routerValue('L5', 'Good desc')]),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('missing descriptions'))).toBe(true);
    });

    test('router_value with whitespace-only description → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L4', '   '), routerValue('L5', 'Good')]),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('missing descriptions'))).toBe(true);
    });

    test('all route descriptions filled → no description error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L4', 'Take path A'), routerValue('L5', 'Take path B')]),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('missing descriptions'))).toBe(false);
    });
});

// ── Check 5: Loop mode ────────────────────────────────────────────────────────

describe('Check 5 — Loop target LLM must declare loop_mode', () => {
    test('LLM with 2 incoming edges, no loop_mode → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),                   // entry-connected
                    routerNode('3', [routerValue('L2', 'Loop back'), routerValue('L4', 'Exit')]),
                    llmNode('4')
                ],
                edges: [
                    edge('1', '2'), edge('2', '3'),
                    edge('3', '2'), edge('3', '4')  // back-edge creates 2 incoming on node 2
                ]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes("'loop_mode' is not configured"))).toBe(true);
    });

    test('loop LLM with loop_mode=fresh → no loop_mode error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [], loop_mode: 'fresh' }),
                    routerNode('3', [routerValue('L2', 'Loop back'), routerValue('L4', 'Exit')]),
                    llmNode('4')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2'), edge('3', '4')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes("'loop_mode' is not configured"))).toBe(false);
    });

    test('loop LLM with loop_mode=continue and no feedback key → warning (not error)', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [], loop_mode: 'continue' }),
                    routerNode('3', [routerValue('L2', 'Loop back'), routerValue('L4', 'Exit')]),
                    llmNode('4')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2'), edge('3', '4')]
            }
        };
        const { errors, warnings } = validateTopology(asl);
        expect(errors.some(e => e.includes("'loop_mode'"))).toBe(false);
        expect(warnings.some(w => w.includes('no feedback state variable'))).toBe(true);
    });

    test('loop LLM with loop_mode=invalid → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [], loop_mode: 'invalid_value' }),
                    routerNode('3', [routerValue('L2', 'Loop back'), routerValue('L4', 'Exit')]),
                    llmNode('4')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2'), edge('3', '4')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes("'loop_mode' is not configured"))).toBe(true);
    });
});

// ── Cycle detection ───────────────────────────────────────────────────────────

describe('Cycle detection', () => {
    test('LLM ↔ LLM cycle with no Router → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [entryNode('1'), llmNode('2', { input_state_keys: [] }), llmNode('3')],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('contains no Router node'))).toBe(true);
    });

    test('cycle with Router that has no exit → error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L2', 'back'), routerValue('L2b', 'back2')])
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2'), edge('3', '2')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors.some(e => e.includes('all its outgoing edges stay within the cycle'))).toBe(true);
    });

    test('cycle with Router that has an exit → warning not error', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [], loop_mode: 'fresh' }),
                    routerNode('3', [routerValue('L2', 'loop'), routerValue('L4', 'exit')]),
                    llmNode('4')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '2'), edge('3', '4')]
            }
        };
        const { errors, warnings } = validateTopology(asl);
        expect(errors.some(e => e.includes('Infinite loop'))).toBe(false);
        expect(warnings.some(w => w.includes('Cycle detected'))).toBe(true);
    });
});

// ── No graph ──────────────────────────────────────────────────────────────────

describe('Missing graph', () => {
    test('null ASL → error', () => {
        const { errors } = validateTopology(null);
        expect(errors.length).toBeGreaterThan(0);
    });

    test('empty object → error', () => {
        const { errors } = validateTopology({});
        expect(errors.length).toBeGreaterThan(0);
    });
});

// ── Valid graph ───────────────────────────────────────────────────────────────

describe('Valid complete graph', () => {
    test('minimal valid graph → no errors', () => {
        const asl = validGraph();
        const { errors } = validateTopology(asl);
        expect(errors).toHaveLength(0);
    });

    test('valid pipeline Entry→LLM→LLM (terminal) → no errors', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    llmNode('3', { input_state_keys: ['task'] })
                ],
                edges: [edge('1', '2'), edge('2', '3')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors).toHaveLength(0);
    });

    test('valid router branch Entry→LLM→Router→LLM, LLM (both terminal) → no errors', () => {
        const asl = {
            graph: {
                entrypoint: '1',
                state: { schema: { task: 'str' } },
                nodes: [
                    entryNode('1'),
                    llmNode('2', { input_state_keys: [] }),
                    routerNode('3', [routerValue('L4', 'Path A'), routerValue('L5', 'Path B')]),
                    llmNode('4'),
                    llmNode('5')
                ],
                edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('3', '5')]
            }
        };
        const { errors } = validateTopology(asl);
        expect(errors).toHaveLength(0);
    });
});
