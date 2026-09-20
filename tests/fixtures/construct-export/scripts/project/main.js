// Original handwritten project-script fixture.
import {sharedValue} from "../shared.js";
self.__fixtureTrace.push("project-script");
runOnStartup(async runtime => {
  self.__fixtureTrace.push("startup-callback");
  runtime.globalVars.sharedValue = sharedValue;
  runtime.globalVars.contractValue = runtime.data.contractValue;
});
