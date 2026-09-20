# 第三方声明

## 公开分发范围

公开仓库提供适配器与转换器源码、插件源码、原创测试夹具、文档和 `.c3p` 示例工程。GitHub Pages 提供文档、构建后的 `.c3addon` 和 `.c3p` 下载。包含 Construct 引擎的原始 HTML5 导出 ZIP、解压目录及其小游戏转换产物仅在本地验证时使用，不提交到公开仓库，也不由文档站分发；使用者应通过自己的 Construct 编辑器导出。

本文件记录各来源和相应声明，不为主项目、Construct SDK 或其他上游材料新增统一的 MIT、Apache 或其他许可。

## core-js-pure 3.49.0

来源：[zloirock/core-js](https://github.com/zloirock/core-js/tree/v3.49.0/packages/core-js-pure)。本项目使用其 URL 与 URLSearchParams 实现，在宿主缺少相应原生接口时提供兼容能力。以下文本来自安装包 `core-js-pure` 3.49.0 的 `LICENSE`，按 MIT 许可保留。

```text
Copyright (c) 2013–2025 Denis Pushkarev (zloirock.ru)
Copyright (c) 2025–2026 CoreJS Company (core-js.io)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Construct SDK 与用户自行生成的导出

插件结构和开发验证 Schema 参考官方 [Scirra/Construct-Addon-SDK](https://github.com/Scirra/Construct-Addon-SDK)，固定参考提交 `a34e41a246fdbb03ac719597d528d7a5e5de0b02`。Schema 保持上游原样，不打包进 `.c3addon`。该上游快照中未找到独立 LICENSE 文件，本项目未为其声明额外许可。

公开的 `.c3p` 是编辑器项目文件，不是包含完整引擎的 HTML5 运行产物。使用者从 Construct 生成的 HTML5 导出包含 Construct 运行时代码，其权利与适用条款归相应权利方。本机导出记录仅说明验证过程，不表示这些引擎文件随公开仓库或网站分发。

上述 core-js MIT 许可仅适用于 core-js，不适用于 Construct 引擎、SDK、主项目或其他依赖。其他依赖的版本见 `package-lock.json`，其许可随各安装包分发。
