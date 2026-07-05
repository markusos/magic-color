/* @ts-self-types="./magic_color_core.d.ts" */

/**
 * A chosen live board, flat-encoded for the boundary. Vec fields are exposed through
 * `getter_with_clone` (one copy per level load — negligible).
 */
export class LiveLevel {
    static __wrap(ptr) {
        const obj = Object.create(LiveLevel.prototype);
        obj.__wbg_ptr = ptr;
        LiveLevelFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LiveLevelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_livelevel_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bottles() {
        const ret = wasm.__wbg_get_livelevel_bottles(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get capacity() {
        const ret = wasm.__wbg_get_livelevel_capacity(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    get cells() {
        const ret = wasm.__wbg_get_livelevel_cells(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get funnels() {
        const ret = wasm.__wbg_get_livelevel_funnels(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint16Array}
     */
    get hidden() {
        const ret = wasm.__wbg_get_livelevel_hidden(this.__wbg_ptr);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
    /**
     * `(trigger, height)` per tube.
     * @returns {Uint8Array}
     */
    get ice_pairs() {
        const ret = wasm.__wbg_get_livelevel_ice_pairs(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    get m_colors() {
        const ret = wasm.__wbg_get_livelevel_m_colors(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get m_dead_end_density() {
        const ret = wasm.__wbg_get_livelevel_m_dead_end_density(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get m_dig_depth() {
        const ret = wasm.__wbg_get_livelevel_m_dig_depth(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get m_empties() {
        const ret = wasm.__wbg_get_livelevel_m_empties(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get m_forced_move_ratio() {
        const ret = wasm.__wbg_get_livelevel_m_forced_move_ratio(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get m_funnel_load() {
        const ret = wasm.__wbg_get_livelevel_m_funnel_load(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get m_ice_load() {
        const ret = wasm.__wbg_get_livelevel_m_ice_load(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get m_optimal_exact() {
        const ret = wasm.__wbg_get_livelevel_m_optimal_exact(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get m_optimal() {
        const ret = wasm.__wbg_get_livelevel_m_optimal(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get m_two_star_max() {
        const ret = wasm.__wbg_get_livelevel_m_two_star_max(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get min_moves() {
        const ret = wasm.__wbg_get_livelevel_min_moves(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get optimal() {
        const ret = wasm.__wbg_get_livelevel_optimal(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get par() {
        const ret = wasm.__wbg_get_livelevel_par(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The fine composite score the board was selected at (LiveProvenance).
     * @returns {number}
     */
    get score() {
        const ret = wasm.__wbg_get_livelevel_score(this.__wbg_ptr);
        return ret;
    }
    /**
     * The pool seed the chosen board came from (salt-adjusted).
     * @returns {number}
     */
    get seed() {
        const ret = wasm.__wbg_get_livelevel_seed(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `(from, to, count, color)` per move of the stored full-information solution.
     * @returns {Uint8Array}
     */
    get solution() {
        const ret = wasm.__wbg_get_livelevel_solution(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    get two_star_max() {
        const ret = wasm.__wbg_get_livelevel_two_star_max(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set bottles(arg0) {
        wasm.__wbg_set_livelevel_bottles(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set capacity(arg0) {
        wasm.__wbg_set_livelevel_capacity(this.__wbg_ptr, arg0);
    }
    /**
     * @param {Uint8Array} arg0
     */
    set cells(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_livelevel_cells(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Uint8Array} arg0
     */
    set funnels(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_livelevel_funnels(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Uint16Array} arg0
     */
    set hidden(arg0) {
        const ptr0 = passArray16ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_livelevel_hidden(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `(trigger, height)` per tube.
     * @param {Uint8Array} arg0
     */
    set ice_pairs(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_livelevel_ice_pairs(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} arg0
     */
    set m_colors(arg0) {
        wasm.__wbg_set_livelevel_m_colors(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_dead_end_density(arg0) {
        wasm.__wbg_set_livelevel_m_dead_end_density(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_dig_depth(arg0) {
        wasm.__wbg_set_livelevel_m_dig_depth(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_empties(arg0) {
        wasm.__wbg_set_livelevel_m_empties(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_forced_move_ratio(arg0) {
        wasm.__wbg_set_livelevel_m_forced_move_ratio(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_funnel_load(arg0) {
        wasm.__wbg_set_livelevel_m_funnel_load(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_ice_load(arg0) {
        wasm.__wbg_set_livelevel_m_ice_load(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set m_optimal_exact(arg0) {
        wasm.__wbg_set_livelevel_m_optimal_exact(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_optimal(arg0) {
        wasm.__wbg_set_livelevel_m_optimal(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set m_two_star_max(arg0) {
        wasm.__wbg_set_livelevel_m_two_star_max(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set min_moves(arg0) {
        wasm.__wbg_set_livelevel_min_moves(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set optimal(arg0) {
        wasm.__wbg_set_livelevel_optimal(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set par(arg0) {
        wasm.__wbg_set_livelevel_par(this.__wbg_ptr, arg0);
    }
    /**
     * The fine composite score the board was selected at (LiveProvenance).
     * @param {number} arg0
     */
    set score(arg0) {
        wasm.__wbg_set_livelevel_score(this.__wbg_ptr, arg0);
    }
    /**
     * The pool seed the chosen board came from (salt-adjusted).
     * @param {number} arg0
     */
    set seed(arg0) {
        wasm.__wbg_set_livelevel_seed(this.__wbg_ptr, arg0);
    }
    /**
     * `(from, to, count, color)` per move of the stored full-information solution.
     * @param {Uint8Array} arg0
     */
    set solution(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_livelevel_solution(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} arg0
     */
    set two_star_max(arg0) {
        wasm.__wbg_set_livelevel_two_star_max(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) LiveLevel.prototype[Symbol.dispose] = LiveLevel.prototype.free;

/**
 * Core build version, for the diagnostics readout (E9/F5: "show core: wasm/js").
 * @returns {string}
 */
export function core_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.core_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Run the live selection loop (`pickBest`) core-side. `mechanics_mask`: 1 = hidden,
 * 2 = funnel, 4 = ice (registry order is fixed internally). Returns `undefined` when every
 * salted pool comes up empty — the JS side then falls back to its light generator.
 * @param {number} level
 * @param {number} colors
 * @param {number} bottles
 * @param {number} capacity
 * @param {number} seed
 * @param {number} mechanics_mask
 * @param {number} density_hidden
 * @param {number} density_funnel
 * @param {number} density_ice
 * @param {number} target
 * @param {number} pool_size
 * @param {number} finalists
 * @param {number} fine_dead_end_samples
 * @returns {LiveLevel | undefined}
 */
export function generate_live(level, colors, bottles, capacity, seed, mechanics_mask, density_hidden, density_funnel, density_ice, target, pool_size, finalists, fine_dead_end_samples) {
    const ret = wasm.generate_live(level, colors, bottles, capacity, seed, mechanics_mask, density_hidden, density_funnel, density_ice, target, pool_size, finalists, fine_dead_end_samples);
    return ret === 0 ? undefined : LiveLevel.__wrap(ret);
}

/**
 * First move of an optimal continuation (the in-game hint / auto-solve step), or `-1` when
 * there is nothing to suggest (solved, stuck, or node budget exhausted). Encoded as
 * `(from << 8) | to` — bottle counts are ≤ 15, so a byte each is generous.
 * @param {Uint8Array} cells
 * @param {number} bottles
 * @param {number} capacity
 * @param {Uint16Array} hidden
 * @param {Uint8Array} funnels
 * @param {Uint8Array} ice_pairs
 * @param {number} max_nodes
 * @returns {number}
 */
export function hint(cells, bottles, capacity, hidden, funnels, ice_pairs, max_nodes) {
    const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray16ToWasm0(hidden, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(funnels, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(ice_pairs, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.hint(ptr0, len0, bottles, capacity, ptr1, len1, ptr2, len2, ptr3, len3, max_nodes);
    return ret;
}

/**
 * First `n` draws of `mulberry32(seed)` — the F0 boundary smoke test, kept as a cheap
 * self-check the adapter can assert at init.
 * @param {number} seed
 * @param {number} n
 * @returns {Float64Array}
 */
export function rng_sample(seed, n) {
    const ret = wasm.rng_sample(seed, n);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * Whether the player is provably circling (every reachable state already visited this
 * attempt) — the core-side `isStuckInLoop`, same conservative semantics (budget-inconclusive
 * ⇒ false).
 * @param {Uint8Array} cells
 * @param {number} bottles
 * @param {number} capacity
 * @param {Uint8Array} funnels
 * @param {number} max_nodes
 * @returns {boolean}
 */
export function stuck_check(cells, bottles, capacity, funnels, max_nodes) {
    const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(funnels, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.stuck_check(ptr0, len0, bottles, capacity, ptr1, len1, max_nodes);
    return ret !== 0;
}

/**
 * Start a fresh attempt: clear the registry and record the initial board.
 * @param {Uint8Array} cells
 * @param {number} bottles
 * @param {number} capacity
 */
export function stuck_reset(cells, bottles, capacity) {
    const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.stuck_reset(ptr0, len0, bottles, capacity);
}

/**
 * Record a reached board (call after every applied move — including undo targets, which are
 * already present from their first visit).
 * @param {Uint8Array} cells
 * @param {number} bottles
 * @param {number} capacity
 */
export function stuck_visit(cells, bottles, capacity) {
    const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.stuck_visit(ptr0, len0, bottles, capacity);
}

/**
 * Registry size — for the E9 diagnostics readout and adapter tests.
 * @returns {number}
 */
export function stuck_visited_count() {
    const ret = wasm.stuck_visited_count();
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./magic_color_core_bg.js": import0,
    };
}

const LiveLevelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_livelevel_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('magic_color_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
