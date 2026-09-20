const SDK = globalThis.SDK;
const PLUGIN_ID = "C3MiniGameBridge";

const PLUGIN_CLASS = SDK.Plugins.C3MiniGameBridge = class MiniGameBridge extends SDK.IPluginBase
{
	constructor()
	{
		super(PLUGIN_ID);
		SDK.Lang.PushContext("plugins." + PLUGIN_ID.toLowerCase());
		this._info.SetName(globalThis.lang(".name"));
		this._info.SetDescription(globalThis.lang(".description"));
		this._info.SetCategory("platform-specific");
		this._info.SetAuthor("MiniGameBridge contributors");
		this._info.SetHelpUrl(globalThis.lang(".help-url"));
		this._info.SetIsSingleGlobal(true);
		this._info.SetRuntimeModuleMainScript("c3runtime/main.js");
		SDK.Lang.PushContext(".properties");
		this._info.SetProperties([
			new SDK.PluginProperty("combo", "platform", {
				initialValue: "auto", items: ["auto", "douyin", "wechat", "tiktok"]
			}),
			new SDK.PluginProperty("text", "score-endpoint", "")
		]);
		SDK.Lang.PopContext();
		SDK.Lang.PopContext();
	}
};

PLUGIN_CLASS.Register(PLUGIN_ID, PLUGIN_CLASS);
