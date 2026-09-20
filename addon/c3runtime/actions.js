// Event-sheet actions report failures through OnError. Public JavaScript methods
// additionally reject, so script callers can use try/catch.
globalThis.C3.Plugins.C3MiniGameBridge.Acts = {
	async Init() { try { await this.init(); } catch {} },
	async Login() { try { await this.login(); } catch {} },
	async ShowRewardedVideo(adUnitId) { try { await this.showRewardedVideo(adUnitId); } catch {} },
	async ReportScore(score, leaderboardId) { try { await this.reportScore(score, leaderboardId); } catch {} },
	async Vibrate(type) { try { await this.vibrate(type === 1 ? "long" : "short"); } catch {} },
	async CallAPI(name, optionsJSON, tag) { try { await this._callAPIJSON(name, optionsJSON, tag); } catch {} },
	async ReadAPISync(name, argsJSON, tag) { try { this._getAPISyncJSON(name, argsJSON, tag); } catch {} },
	async SubscribeAPIEvent(name, tag) { try { this._subscribeAPIEvent(name, tag); } catch {} },
	async UnsubscribeAPIEvent(name, tag) { try { this._unsubscribeAPIEvent(name, tag); } catch {} },
	async ShowToast(title, duration, tag) { try { await this._callAPIFromOptions("showToast", () => ({ title, duration, icon: "none" }), tag); } catch {} },
	async ShowModal(title, content, showCancel, tag) { try { await this._callAPIFromOptions("showModal", () => ({ title, content, showCancel: showCancel === 1 }), tag); } catch {} },
	async SetStorage(key, valueJSON, tag) { try { await this._setStorageJSON(key, valueJSON, tag); } catch {} },
	async GetStorage(key, tag) { try { await this._callAPIFromOptions("getStorage", () => ({ key }), tag); } catch {} },
	async RemoveStorage(key, tag) { try { await this._callAPIFromOptions("removeStorage", () => ({ key }), tag); } catch {} },
	async GetNetworkType(tag) { try { await this._callAPIFromOptions("getNetworkType", () => ({}), tag); } catch {} },
	async SetClipboard(text, tag) { try { await this._callAPIFromOptions("setClipboardData", () => ({ data: text }), tag); } catch {} },
	async GetClipboard(tag) { try { await this._callAPIFromOptions("getClipboardData", () => ({}), tag); } catch {} },
	async ShowKeyboard(value, maxLength, tag) { try { await this._callAPIFromOptions("showKeyboard", () => ({ defaultValue: value, maxLength, multiple: false, confirmHold: false, confirmType: "done", ...(["wechat", "tiktok"].includes(this.getPlatform()) ? { keyboardType: "text" } : {}) }), tag); } catch {} },
	async HideKeyboard(tag) { try { await this._callAPIFromOptions("hideKeyboard", () => ({}), tag); } catch {} }
};
