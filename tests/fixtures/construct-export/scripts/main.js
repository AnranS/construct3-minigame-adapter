// Original handwritten fixture: not part of the Construct engine.
(() => {
const startupFunctions = [];
self.runOnStartup = fn => startupFunctions.push(fn);
function loadModule(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
self.RuntimeInterface = class {
  constructor(options) {
    self.__fixtureTrace = ["bootstrap"];
    self.__fixtureDone = this.start(options);
  }
  async start(options) {
    let create, initialize;
    const canvas = document.createElement("canvas");
    canvas.style.display = "none";
    document.body.appendChild(canvas);
    self.c3canvas = canvas;
    globalThis.C3_SetInitFunctions = (createCallback, initializeCallback) => {
      create = createCallback;
      initialize = initializeCallback;
      globalThis.C3_SetInitFunctions = null;
    };
    await loadModule(options.runtimeMainScript);
    await loadModule(options.projectMainScriptPath);
    const runtimeOptions = {
      isInWorker: false,
      canvas,
      runOnStartupFunctions: startupFunctions
    };
    const runtime = create(runtimeOptions);
    await initialize(runtime, runtimeOptions);
  }
};
if (self.C3_IsSupported) {
  self.c3_runtimeInterface = new self.RuntimeInterface({
    useWorker: false,
    workerMainUrl: "workermain.js",
    runtimeMainScript: "scripts/c3main.js",
    projectMainScriptPath: "scripts/project/main.js",
    scriptFolder: "scripts/",
    exportType: "html5"
  });
}

})();
