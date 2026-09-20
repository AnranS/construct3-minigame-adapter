globalThis.C3.Plugins.C3MiniGameBridge.Cnds = {
	OnReady() { return true; },
	OnLoginSucceeded() { return true; },
	OnAdCompleted() { return true; },
	OnAdCancelled() { return true; },
	OnScoreReported() { return true; },
	OnVibrationCompleted() { return true; },
	OnError() { return true; },
	OnAPISucceeded(tag) { return this._matchesAPITag(tag); },
	OnAPIEvent(tag) { return this._matchesAPITag(tag); },
	IsReady() { return this.isReady(); },
	SupportsAPI(name) { return this.supportsAPI(name); }
};
