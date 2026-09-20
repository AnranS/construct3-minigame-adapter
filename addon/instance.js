const SDK = globalThis.SDK;
SDK.Plugins.C3MiniGameBridge.Instance = class MiniGameBridgeInstance extends SDK.IInstanceBase
{
	constructor(sdkType, inst)
	{
		super(sdkType, inst);
	}
	Release() {}
	OnCreate() {}
	OnPropertyChanged() {}
	LoadC2Property() { return false; }
};
