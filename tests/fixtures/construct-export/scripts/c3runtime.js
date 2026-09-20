// Original handwritten fixture: NOT the Construct runtime.
function create(options) {
  self.__fixtureTrace.push("create");
  return { canvas: options.canvas, initialized: false, globalVars: {} };
}
async function initialize(runtime, options) {
  runtime.data = await (await fetch("data.json")).json();
  const dispatch = new Worker(new URL("scripts/dispatchworker.js", location.href));
  const job = new Worker(new URL("scripts/jobworker.js", location.href));
  const input = new MessageChannel(), bridge = new MessageChannel(), output = new MessageChannel();
  dispatch.postMessage({type: "_init", "in-port": input.port2}, [input.port2]);
  dispatch.postMessage({type: "_addJobWorker", port: bridge.port1}, [bridge.port1]);
  job.postMessage({type: "init", "dispatch-port": bridge.port2, "output-port": output.port2}, [bridge.port2, output.port2]);
  const completed = new Promise(resolve => { output.port1.onmessage = ({data}) => resolve(data); });
  const bytes = new Uint8Array([21]);
  input.port1.postMessage({id: 3, bytes}, [bytes.buffer]);
  runtime.workerValue = (await completed).bytes[0];
  dispatch.terminate(); job.terminate();
  for (const callback of options.runOnStartupFunctions) await callback(runtime);
  runtime.initialized = true;
  self.__fixtureRuntime = runtime;
  self.__fixtureTrace.push("initialized");
}
self.__fixtureTrace.push("engine-module");
globalThis.C3_SetInitFunctions(create, initialize);
