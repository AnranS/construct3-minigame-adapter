import {createEngineScope} from '../runtime/scope.js';

// Esbuild rewrites only unresolved identifiers, preserving module/worker local bindings.
// Property access remains live: engine scripts can publish globals after startup.
export function engineScopeBuildOptions(platform) {
  const globals = `document navigator location Image Audio HTMLCanvasElement HTMLImageElement HTMLAudioElement HTMLElement ImageData Event PointerEvent EventTarget Headers Response Request localStorage sessionStorage performance screen innerWidth innerHeight outerWidth outerHeight devicePixelRatio addEventListener removeEventListener dispatchEvent getComputedStyle matchMedia fetch XMLHttpRequest requestAnimationFrame cancelAnimationFrame Worker MessageChannel MessagePort AudioContext webkitAudioContext Blob URL URLSearchParams atob btoa WebAssembly OffscreenCanvas createImageBitmap indexedDB alert focus runOnStartup C3 C3_GetObjectRefTable C3_JsPropNameTable InstanceType C3MiniGameBridge`.split(' ');
  // Unsupported browser capabilities must stay absent, even inside a desktop IDE
  // with a surrounding Chromium DOM. Never borrow that DOM by accident.
  globals.push(...`requestIdleCallback cancelIdleCallback HTMLDialogElement IDBObjectStore ImageBitmap HTMLVideoElement HTMLMediaElement FontFace File FileReader DOMRect DOMQuad DOMPoint history isSecureContext localforage WebSocket`.split(' '));
  // Bare calls and self/globalThis calls must use the same correctly bound host
  // functions. Otherwise copied Window methods can escape the receiver repair.
  globals.push(...`setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone`.split(' '));
  return {
    define: {
      ...Object.fromEntries(['globalThis', 'window', 'self', 'global', 'GameGlobal', 'top', 'parent'].map(name => [name, '__c3EngineScope'])),
      ...Object.fromEntries(globals.map(name => [name, `__c3EngineScope.${name}`]))
    },
    banner: {js: `(function(__c3NativeHost, __c3NativeBindings, __c3NativeGlobal) {\nconst __c3EngineScope = (${createEngineScope.toString()})(__c3NativeHost, {platform: ${JSON.stringify(platform)}, nativeBindings: __c3NativeBindings, nativeGlobal: __c3NativeGlobal});\n__c3NativeHost.__C3MiniGameScope = __c3EngineScope;`},
    footer: {js: `\n})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis, {wx: typeof wx !== 'undefined' ? wx : undefined, tt: typeof tt !== 'undefined' ? tt : undefined, TTMinis: typeof TTMinis !== 'undefined' ? TTMinis : undefined, WebAssembly: typeof WebAssembly !== 'undefined' ? WebAssembly : undefined, WXWebAssembly: typeof WXWebAssembly !== 'undefined' ? WXWebAssembly : undefined, TTWebAssembly: typeof TTWebAssembly !== 'undefined' ? TTWebAssembly : undefined}, globalThis);`}
  };
}
