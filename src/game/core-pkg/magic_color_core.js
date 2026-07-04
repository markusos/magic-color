/* @ts-self-types="./magic_color_core.d.ts" */

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

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
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
