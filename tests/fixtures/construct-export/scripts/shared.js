// Original handwritten shared ES module. Static imports must evaluate this only once.
self.__fixtureSharedLoads = (self.__fixtureSharedLoads || 0) + 1;
export const sharedValue = 42;
