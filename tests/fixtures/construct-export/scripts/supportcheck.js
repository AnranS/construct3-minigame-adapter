// Original handwritten fixture: not part of the Construct engine.
// A browser capability probe must not consume the platform's on-screen canvas.
self.__fixtureProbeCanvas = document.createElement("canvas");
self.C3_IsSupported = Boolean(self.__fixtureProbeCanvas.getContext("webgl"));
