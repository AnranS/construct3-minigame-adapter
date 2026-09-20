const PLATFORMS = ["auto", "douyin", "wechat", "tiktok"];

function bridgeError(code, message)
{
	return Object.assign(new Error(message), { code });
}

function normalizeError(error)
{
	const code = String(error?.code ?? error?.errCode ?? "BRIDGE_ERROR");
	const message = error instanceof Error ? error.message
		: typeof error === "string" ? error
		: String(error?.message ?? error?.errMsg ?? "Mini game operation failed.");
	return bridgeError(code, message);
}

function parseJSON(text, shape = "value")
{
	let value;
	try { value = JSON.parse(String(text)); }
	catch { throw bridgeError("INVALID_JSON", "Expected valid JSON."); }
	if (shape === "object" && (value === null || typeof value !== "object" || Array.isArray(value)))
		throw bridgeError("INVALID_ARGUMENT", "API options must be a JSON object.");
	if (shape === "array" && !Array.isArray(value))
		throw bridgeError("INVALID_ARGUMENT", "Synchronous API arguments must be a JSON array.");
	return value;
}

function isPlainObjectPrototype(prototype)
{
	if (prototype === null || prototype === Object.prototype) return true;
	// Native callbacks can return objects from the IDE/platform's other realm.
	// Compare the foreign realm's native Object constructor without invoking
	// user getters or accepting a class/custom prototype merely named Object.
	if (Object.getPrototypeOf(prototype) !== null) return false;
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	if (Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype) return false;
	return Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
}

// JSON.stringify silently loses undefined, typed bytes, object identity and
// accessors. Only publish JSON when the value is a lossless JSON data tree.
function jsonSnapshot(value)
{
	let type = value === null ? "null" : typeof value;
	try { if (Array.isArray(value)) type = "array"; }
	catch { return { json: "", isJSON: false, type }; }
	const stack = new Set();
	const copies = new WeakMap();
	function check(item)
	{
		if (item === null || typeof item === "string" || typeof item === "boolean") return true;
		if (typeof item === "number") return Number.isFinite(item) && !Object.is(item, -0);
		if (typeof item !== "object" || stack.has(item)) return false;
		const array = Array.isArray(item);
		const prototype = Object.getPrototypeOf(item);
		if (!array && !isPlainObjectPrototype(prototype)) return false;
		const descriptors = Object.getOwnPropertyDescriptors(item);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some(key => typeof key !== "string")) return false;
		if (array && (keys.length !== item.length + 1 || keys.some(key => key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) return false;
		stack.add(item);
		try
		{
			const copy = array ? [] : Object.create(null);
			// Serialize descriptor values, not the native object itself: inherited
			// toJSON hooks must not change the reported result or execute user code.
			if (array) Object.defineProperty(copy, "toJSON", { value: undefined });
			for (const key of keys)
			{
				if (array && key === "length") continue;
				const descriptor = descriptors[key];
				if (!("value" in descriptor) || !descriptor.enumerable || !check(descriptor.value)) return false;
				const child = descriptor.value;
				copy[key] = child !== null && typeof child === "object" ? copies.get(child) : child;
			}
			copies.set(item, copy);
			return true;
		}
		finally { stack.delete(item); }
	}
	try
	{
		if (check(value)) return { json: JSON.stringify(value !== null && typeof value === "object" ? copies.get(value) : value), isJSON: true, type };
	}
	catch { /* A native object or proxy may not permit inspection. */ }
	return { json: "", isJSON: false, type };
}

globalThis.C3.Plugins.C3MiniGameBridge.Instance = class MiniGameBridgeInstance extends globalThis.ISDKInstanceBase
{
	constructor()
	{
		super();
		const properties = this._getInitProperties();
		this._platformSetting = PLATFORMS[properties?.[0] ?? 0] ?? "auto";
		this._scoreEndpoint = String(properties?.[1] ?? "");
		this._ready = false;
		this._disposed = false;
		this._lastError = "";
		this._lastErrorCode = "";
		this._lastOperation = "";
		this._lastLoginCode = "";
		this._lastAPIName = "";
		this._lastAPITag = "";
		this._lastResult = jsonSnapshot(undefined);
		this._lastEvent = jsonSnapshot(undefined);
		this._activeAPIContext = null;
		this._apiSubscriptions = new Set();
		this._namedSubscriptions = new Map();
	}

	_release()
	{
		this._disposed = true;
		this._ready = false;
		this._lastLoginCode = "";
		this._clearSubscriptions();
		this._lastResult = jsonSnapshot(undefined);
		this._lastEvent = jsonSnapshot(undefined);
		this._activeAPIContext = null;
		super._release();
	}

	_saveToJson()
	{
		// One-time login codes and session credentials must not enter savegames.
		return {};
	}

	_loadFromJson()
	{
		this._lastLoginCode = "";
		this._lastError = "";
		this._lastErrorCode = "";
		this._lastOperation = "";
		this._lastAPIName = "";
		this._lastAPITag = "";
		this._lastResult = jsonSnapshot(undefined);
		this._lastEvent = jsonSnapshot(undefined);
		this._clearSubscriptions();
	}

	_getBridge(method, needsReady = true)
	{
		if (this._disposed)
			throw bridgeError("DISPOSED", "MiniGameBridge instance has been released.");
		const bridge = globalThis.C3MiniGameBridge;
		if (!bridge || typeof bridge[method] !== "function")
			throw bridgeError("UNSUPPORTED", "The mini game bridge is unavailable. Run the converted package in the selected mini game host; browser preview does not simulate platform success.");
		if (needsReady && !this._ready)
			throw bridgeError("NOT_READY", "Call Init and wait for On ready before using platform actions.");
		return bridge;
	}

	_emit(name)
	{
		if (!this._disposed)
			this._trigger(globalThis.C3.Plugins.C3MiniGameBridge.Cnds[name]);
	}

	async _run(operation, callback, trigger)
	{
		try
		{
			const result = await callback();
			if (this._disposed)
				throw bridgeError("DISPOSED", "MiniGameBridge instance was released during the operation.");
			this._lastOperation = operation;
			this._lastError = "";
			this._lastErrorCode = "";
			this._lastAPIName = "";
			this._lastAPITag = "";
			if (trigger)
				this._emit(typeof trigger === "function" ? trigger(result) : trigger);
			return result;
		}
		catch (error)
		{
			const normalized = normalizeError(error);
			if (!this._disposed)
			{
				this._lastOperation = operation;
				this._lastErrorCode = normalized.code;
				this._lastError = `[${normalized.code}] ${normalized.message}`;
				this._lastAPIName = "";
				this._lastAPITag = "";
				this._emit("OnError");
			}
			throw normalized;
		}
	}

	async init()
	{
		this._ready = false;
		return this._run("init", async () => {
			const bridge = this._getBridge("init", false);
			const result = await bridge.init({ platform: this._platformSetting, scoreEndpoint: this._scoreEndpoint });
			if (this._disposed)
				throw bridgeError("DISPOSED", "MiniGameBridge instance was released during initialization.");
			const platform = typeof bridge.getPlatform === "function" ? bridge.getPlatform() : "unsupported";
			if (platform !== "douyin" && platform !== "wechat" && platform !== "tiktok")
				throw bridgeError("UNSUPPORTED", "Initialization did not identify a supported mini game host.");
			this._ready = true;
			return result;
		}, "OnReady");
	}

	async login()
	{
		this._lastLoginCode = "";
		return this._run("login", async () => {
			const result = await this._getBridge("login").login();
			if (!(typeof result?.code === "string" && result.code.length > 0) && !result?.session)
				throw bridgeError("INVALID_RESULT", "Login returned neither a platform code nor a server session.");
			if (!this._disposed)
				this._lastLoginCode = typeof result.code === "string" ? result.code : "";
			return result;
		}, "OnLoginSucceeded");
	}

	async showRewardedVideo(adUnitId)
	{
		return this._run("showRewardedVideo", async () => {
			const result = await this._getBridge("showRewardedVideo").showRewardedVideo({ adUnitId: String(adUnitId) });
			if (typeof result?.completed !== "boolean")
				throw bridgeError("INVALID_RESULT", "The rewarded ad did not return an explicit completion status.");
			return result;
		}, result => result.completed ? "OnAdCompleted" : "OnAdCancelled");
	}

	async reportScore(score, leaderboardId = "")
	{
		return this._run("reportScore", () => this._getBridge("reportScore").reportScore({ score, leaderboardId }), "OnScoreReported");
	}

	async vibrate(type = "short")
	{
		return this._run("vibrate", () => this._getBridge("vibrate").vibrate({ type }), "OnVibrationCompleted");
	}

	_apiContext(operation, name, tag, result, isEvent = false)
	{
		return {
			operation, name: String(name), tag: String(tag), error: "", code: "",
			result: isEvent ? this._lastResult : jsonSnapshot(result),
			event: isEvent ? jsonSnapshot(result) : this._lastEvent
		};
	}

	_recordAPI(context)
	{
		this._lastOperation = context.operation;
		this._lastAPIName = context.name;
		this._lastAPITag = context.tag;
		this._lastError = context.error;
		this._lastErrorCode = context.code;
		this._lastResult = context.result;
		this._lastEvent = context.event;
	}

	_withAPIContext(context, callback)
	{
		const previous = this._activeAPIContext;
		this._activeAPIContext = context;
		try { return callback(); }
		finally { this._activeAPIContext = this._disposed ? null : previous; }
	}

	_apiSuccess(operation, name, tag, result)
	{
		if (this._disposed) throw bridgeError("DISPOSED", "MiniGameBridge instance was released during the operation.");
		const context = this._apiContext(operation, name, tag, result);
		this._recordAPI(context);
		this._withAPIContext(context, () => this._emit("OnAPISucceeded"));
		return result;
	}

	_apiFailure(operation, name, tag, error)
	{
		const normalized = normalizeError(error);
		if (!this._disposed)
		{
			const context = this._apiContext(operation, name, tag, undefined);
			context.code = normalized.code;
			context.error = `[${normalized.code}] ${normalized.message}`;
			this._recordAPI(context);
			this._withAPIContext(context, () => this._emit("OnError"));
		}
		return normalized;
	}

	async _runAPI(operation, name, tag, callback)
	{
		try { return this._apiSuccess(operation, name, tag, await callback()); }
		catch (error) { throw this._apiFailure(operation, name, tag, error); }
	}

	_runAPISync(operation, name, tag, callback)
	{
		try { return this._apiSuccess(operation, name, tag, callback()); }
		catch (error) { throw this._apiFailure(operation, name, tag, error); }
	}

	callAPI(name, options = {}, control = {})
	{
		let nativePromise;
		const promise = this._runAPI("callAPI", name, "", () => {
			nativePromise = this._getBridge("callAPI").callAPI(name, options, control);
			return nativePromise;
		});
		Object.defineProperty(promise, "abort", { value: () => {
			if (typeof nativePromise?.abort === "function") return nativePromise.abort();
		} });
		return promise;
	}

	getAPISync(name, ...args)
	{
		return this._runAPISync("getAPISync", name, "", () => this._getBridge("getAPISync").getAPISync(name, ...args));
	}

	createAPIObject(name, options)
	{
		return this._runAPISync("createAPIObject", name, "", () => this._getBridge("createAPIObject").createAPIObject(name, options));
	}

	_callAPIFromOptions(name, optionsFactory, tag = "")
	{
		return this._runAPI("callAPI", name, tag, () => {
			const options = optionsFactory();
			return this._getBridge("callAPI").callAPI(name, options);
		});
	}

	_callAPIJSON(name, optionsJSON, tag)
	{
		return this._callAPIFromOptions(name, () => parseJSON(optionsJSON, "object"), tag);
	}

	_getAPISyncJSON(name, argsJSON, tag = "")
	{
		return this._runAPISync("getAPISync", name, tag, () => {
			const args = parseJSON(argsJSON, "array");
			return this._getBridge("getAPISync").getAPISync(name, ...args);
		});
	}

	_setStorageJSON(key, valueJSON, tag)
	{
		return this._callAPIFromOptions("setStorage", () => ({ key, data: parseJSON(valueJSON) }), tag);
	}

	_registerAPIEvent(name, callback, tag, namedKey)
	{
		if (typeof callback !== "function") throw bridgeError("INVALID_ARGUMENT", "Event callback must be a function.");
		const bridge = this._getBridge("onAPIEvent");
		const token = { active: true, unsubscribe: null };
		let unsubscribe = null;
		token.unsubscribe = () => {
			if (!token.active) return;
			token.active = false;
			this._apiSubscriptions.delete(token);
			if (namedKey !== undefined && this._namedSubscriptions.get(namedKey) === token.unsubscribe)
				this._namedSubscriptions.delete(namedKey);
			if (unsubscribe) unsubscribe();
		};
		this._apiSubscriptions.add(token);
		if (namedKey !== undefined) this._namedSubscriptions.set(namedKey, token.unsubscribe);
		const instance = this;
		const listener = function (...args) {
			if (!token.active || instance._disposed) return;
			const data = args.length > 1 ? args : args[0];
			const context = instance._apiContext("onAPIEvent", name, tag, data, true);
			instance._recordAPI(context);
			return instance._withAPIContext(context, () => {
				instance._emit("OnAPIEvent");
				if (!token.active || instance._disposed) return;
				try { return callback.apply(this, args); }
				catch (error) { instance._apiFailure("onAPIEvent", name, tag, bridgeError("CALLBACK_ERROR", normalizeError(error).message)); }
			});
		};
		try
		{
			unsubscribe = bridge.onAPIEvent(name, listener);
			if (typeof unsubscribe !== "function")
			{
				unsubscribe = null;
				throw bridgeError("INVALID_RESULT", "Event registration did not return an unsubscribe function.");
			}
			// The native registration may deliver an event synchronously, and that
			// trigger can unsubscribe or release the instance before registration returns.
			if (!token.active) unsubscribe();
			if (this._disposed) throw bridgeError("DISPOSED", "MiniGameBridge was released while subscribing.");
		}
		catch (error)
		{
			token.unsubscribe();
			throw error;
		}
		return token.unsubscribe;
	}

	onAPIEvent(name, callback)
	{
		try
		{
			const unsubscribe = this._registerAPIEvent(name, callback, "");
			return () => {
				try { unsubscribe(); }
				catch (error) { throw this._apiFailure("offAPIEvent", name, "", error); }
			};
		}
		catch (error) { throw this._apiFailure("onAPIEvent", name, "", error); }
	}

	_subscribeAPIEvent(name, tag = "")
	{
		return this._runAPISync("subscribeAPIEvent", name, tag, () => {
			const key = JSON.stringify([String(name), String(tag)]);
			const previous = this._namedSubscriptions.get(key);
			if (previous) { previous(); this._namedSubscriptions.delete(key); }
			this._registerAPIEvent(name, () => {}, tag, key);
			return { subscribed: this._namedSubscriptions.has(key) };
		});
	}

	_unsubscribeAPIEvent(name, tag = "")
	{
		return this._runAPISync("unsubscribeAPIEvent", name, tag, () => {
			this._getBridge("onAPIEvent");
			const key = JSON.stringify([String(name), String(tag)]);
			const unsubscribe = this._namedSubscriptions.get(key);
			if (unsubscribe) { unsubscribe(); this._namedSubscriptions.delete(key); }
			return { unsubscribed: Boolean(unsubscribe) };
		});
	}

	_clearSubscriptions()
	{
		for (const token of this._apiSubscriptions)
		{
			try { token.unsubscribe(); }
			catch { /* Released/load-reset instances must never emit new events. */ }
		}
		this._apiSubscriptions.clear();
		this._namedSubscriptions.clear();
	}

	supportsAPI(name)
	{
		try { return Boolean(this._getBridge("supportsAPI", false).supportsAPI(name)); }
		catch { return false; }
	}

	getCapabilities()
	{
		return this._getBridge("getCapabilities", false).getCapabilities();
	}

	getCapabilitiesJSON()
	{
		try { return jsonSnapshot(this.getCapabilities()).json; }
		catch { return ""; }
	}

	_matchesAPITag(tag) { return this.getLastAPITag() === String(tag); }
	getLastAPIName() { return this._activeAPIContext?.name ?? this._lastAPIName; }
	getLastAPITag() { return this._activeAPIContext?.tag ?? this._lastAPITag; }
	getLastResultJSON() { return (this._activeAPIContext?.result ?? this._lastResult).json; }
	getLastResultIsJSON() { return (this._activeAPIContext?.result ?? this._lastResult).isJSON; }
	getLastResultType() { return (this._activeAPIContext?.result ?? this._lastResult).type; }
	getLastEventJSON() { return (this._activeAPIContext?.event ?? this._lastEvent).json; }
	getLastEventIsJSON() { return (this._activeAPIContext?.event ?? this._lastEvent).isJSON; }
	getLastEventType() { return (this._activeAPIContext?.event ?? this._lastEvent).type; }

	getPlatform()
	{
		const bridge = globalThis.C3MiniGameBridge;
		if (!bridge || typeof bridge.getPlatform !== "function") return "unsupported";
		try { return String(bridge.getPlatform()); }
		catch { return "unsupported"; }
	}
	getLastError() { return this._activeAPIContext?.error ?? this._lastError; }
	getLastErrorCode() { return this._activeAPIContext?.code ?? this._lastErrorCode; }
	getLastOperation() { return this._activeAPIContext?.operation ?? this._lastOperation; }
	getLastLoginCode() { return this._lastLoginCode; }
	isReady() { return this._ready; }
};
