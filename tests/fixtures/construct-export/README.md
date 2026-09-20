# Handwritten Construct export contract fixture

This directory contains an original, small test fixture, **not a Construct game or the Construct engine**. It is designed to exercise the shape of the modern HTML5 startup contract:

- an HTML script starts `RuntimeInterface`;
- the DOM-side bootstrap loads an ES module using a script element;
- `c3main.js` imports engine and object-reference modules;
- `C3_SetInitFunctions` registers create/init callbacks;
- a project script registers a `runOnStartup` callback;
- runtime initialization reads a bundled JSON asset.

Passing these tests validates the build tool and those adapter paths. It does not establish that a genuine Construct runtime works on WeChat or Douyin, nor that graphics, audio, shaders, workers, or third-party addons work on devices. No proprietary Construct runtime code or third-party game assets are included.
