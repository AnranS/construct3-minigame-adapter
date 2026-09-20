# 本机微信 IDE Modal Worker 丢失查询参数的证据

日期：2026-09-20。环境：macOS，微信开发者工具 RC 2.02.2607161。

本记录是本机安装包的只读分析和隔离函数复现，不是微信官方故障公告。未修改 IDE、基础库、项目配置或网络请求，未开启服务端口。没有下载其他 IDE 版本。

## 实际观察

主任务 UI 重复观察：3.15.3 / 3.12.1 完整重开后，启动成功，原生 Modal 可显示并回调，但点击 Modal 立即产生 `worker path empty`。Network 里对应请求包含：

```text
/game/s1/_sessionId/simulator-app-session-s1/__WORKER__/worker.js?libName=WAAccelerateWorker.js
```

## 确认的代码链

1. WAGame.js Modal 的内部质量报告路径可懒加载 `WAAccelerateWorker.js`；IDE `js/extensions/worker/asdebug/index.js` 为该 Worker 生成带 `libName` 的 URL。
2. `js/384885f85e653c121a5b9fe96f0a3088.js`，`AppserviceController.onHandleContainerRequest` 使用 `parsedUrl(request.path, sessionPrefix)`，然后在 `this.isGame` 分支调用 `simulatorCodeService.serveGameAppservice(request, parsed, sessionId)`。
3. `js/7141d70a632001bdddb65e5d63d2ac25.js`，`parsePath` 将字符串按 `?` 分开。`parsedUrl` 返回独立的 `subPath` 和 `query`。这里 `subPath` 为 `__WORKER__/worker.js`，`query.libName` 为 `WAAccelerateWorker.js`。
4. **漏参位置：`js/8200c33fc6adfcc87f94ac822aa8ec4a.js`，`SimulatorCodeService.serveGameAppservice` 使用 `${this.simulatorHttpService.address}/game/${r.subPath}` 重建 URL，没有追加 `r.query` 或原请求的 search。** `buildProxyContext` → `getParsedUrl` 只解析这个新 URL；存在新 URL 时不会回退到原始 HTTP request。
5. `js/a9cc11502efe0e26cce81894f7c858be.js`，`getGameResource` 从重建 URL 的 `searchParams` 读取 `libName`，因此给后端 `getGameWorkerBundle` 的 `extraLibName` 为 `undefined`。
6. `js/8fd55709f2317870f49b21a86699363d.js`，`getGameWorkerBundleCached` 在非空 `extraLibName` 时直接构建基础库 Worker；为空时转到业务 Worker 编译，业务 `workers` / `workers.path` 为空会抛 `worker path empty`。

## 可重复的内存验证

```sh
node docs/diagnostics/reproduce-ide-worker-query-loss.mjs
```

脚本从本机 `app.asar` 读取源模块，在 VM 中运行真实 `parsedUrl`、`serveGameAppservice`、`getParsedUrl`、`getGameResource` 函数。平台服务被替换成无副作用的参数接收器，不连接 IDE、不发请求、不运行编译器。`licia/query.parse` 使用 Node `URLSearchParams` 解码该单一查询键；真正负责分离 path/query 和重建 URL 的函数均为本机原模块。实际运行通过断言：

```text
parsed.query.libName = WAAccelerateWorker.js
parsed.subPath = __WORKER__/worker.js
rebuilt URL = http://127.0.0.1:1/game/__WORKER__/worker.js
backend options.extraLibName = undefined
```

本地结果和所执行源模块 SHA-256 在 `ide-worker-query-loss-result.json`。这是函数级确认，不冒充后台调试器取得了运行时局部变量，也不是修改后重新验收。

## 进入该路径的条件与替代路径调查

- `js/10bbd7dea8f003df98922ebf4012054d.js` 的 `genCreateSimulatorOptions` 从 `projectManagerService.isGame()` 取得 `isGame`。`js/a43c05b3db5acc94e3d6024ad81b8f00.js` 的实现读取工程属性 `attr.gameApp`。
- `js/faf7dcacc6b31810694b744569044629.js` 创建模拟器；`js/a267286483f0a085764cfaa8a027fe62.js` 用 `!!options.isGame` 实例化 `SimulatorApp`；`js/2c5056ff6b888c80f07998995b7b0534.js` 将此布尔值传给 `AppserviceController`。
- `AppserviceController.createAppserviceController` 无条件注册 session 下的 `devtools-appservice` GET `**` 路由。Worker 不是 mainframe、vendor、Context 或用户脚本专用路径，所以直接落到 `isGame ? serveGameAppservice : serveAppservice`。在这条判断中未发现 `libVersion`、Worker 配置、ES6/压缩编译选项或项目设置分支。
- `js/bb18958f512b7e13ceee0dd6d1fc1aad.js` 无条件将本实现注册为 `ISimulatorCodeService`。
- 同一 `SimulatorCodeService` 还存在通用 `onHandleDevtoolsProxyRequest` → `buildProxyContext(request)`，此路径使用原始 request URL，按源码可保留 query。但本次 session URL 已被容器路由接管；没有找到正常项目配置可把这个内部 Worker 切回通用路径。没有尝试修改内部 Worker URL 或强行绕过容器。
- 因丢参发生在 IDE 的 session URL 转发层，而非 WAGame 版本选择层，回退基础库不能修正该函数；3.15.3 与 3.12.1 实测均复现与此相符。

目前没有经过验证的项目侧修复。给 `game.json` 添加空业务 Worker 会让请求继续走错误的编译分支，不能当作修复。正确修正该 IDE 实现需要保留转发查询参数，属于第三方 IDE 源码修改范围，本任务未执行；可后续使用官方已修正版本验证或向官方提交以上复现，不能在没有验证的情况下声称某一版本已经修复。
