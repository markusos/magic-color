/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const core_version: () => [number, number];
export const hint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
export const rng_sample: (a: number, b: number) => [number, number];
export const stuck_check: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
export const stuck_reset: (a: number, b: number, c: number, d: number) => void;
export const stuck_visit: (a: number, b: number, c: number, d: number) => void;
export const stuck_visited_count: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_start: () => void;
