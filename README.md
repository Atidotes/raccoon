# Raccoon

一只住在 VS Code 里的浣熊，喜欢翻代码垃圾桶，把游戏、办公和小工具都叼回来给你。目前五个功能：

- **Markdown 导出 PDF** —— 纯 JS 实现，不需要本机 Python 环境
- **DeepSeek 余额** —— 在状态栏实时显示账户余额
- **俄罗斯方块** —— 在编辑器旁边开一局复古 CRT 风格的游戏
- **五子棋** —— 人机对战，三种难度
- **贪吃蛇** —— 复古 CRT 风格，越吃越快

左侧活动栏的 Raccoon 图标打开侧边栏，列出这些功能的入口，点击即执行。

## Markdown → PDF

### 用起来

四种入口，都走同一条链路：

- 侧边栏点「Markdown 导出 PDF」
- 命令面板搜 `Raccoon: 导出为 PDF`
- 在 Markdown 编辑器里右键 → 「导出为 PDF」
- 在文件管理器里右键 `.md` 文件 → 「导出为 PDF」

默认在 Markdown 文件同目录生成同名 PDF，完成后弹通知，点「打开 PDF」直接用系统默认程序打开。

### 转换过程

```
Markdown --marked--> HTML --headless Chrome--> PDF
```

- **解析**：`marked`（GFM，支持表格、围栏代码块），随扩展打包
- **渲染**：本机已安装的 Chrome / Chromium / Edge 无头模式

### 相比原始的 Python 脚本

功能最初是一个 `md2pdf.py` 脚本（已删除，完全被本插件覆盖）。两者的差异：

| | Python 脚本 | 本插件 |
| --- | --- | --- |
| Python 环境 | 必需 | 不需要 |
| Markdown 解析 | `pip install markdown` | `marked`，随扩展打包 |
| 渲染引擎 | Chrome 或 weasyprint | 仅 Chrome / Chromium / Edge |
| 相对链接改写 | 支持 | 支持 |
| 标题锚点 | 死链（Python-Markdown 默认不加 header id） | 可用（`marked-gfm-heading-id`） |
| 页码页脚 | 支持 | 支持 |

保留的行为：GitHub 风格 A4 样式、文档内指向仓库文件的相对链接改写成 `file://` 绝对地址（代码围栏内的链接不动）、页脚页码、表格与代码块避免跨页断开。

### 设置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `raccoon.pdf.outputPath` | 空 | 留空则与 md 同目录同名。填目录则在该目录下生成同名 PDF；也可直接写完整 `.pdf` 路径。相对路径基于工作区根目录解析。 |
| `raccoon.pdf.chromePath` | 空 | 留空则自动探测常见安装目录、`PATH`、`CHROME_BIN` 环境变量。 |

## DeepSeek 余额

状态栏右侧显示账户余额，鼠标悬停看明细（总计 / 赠送 / 充值），点击立即刷新。

插件注册了 `onStartupFinished` 激活事件：窗口启动完成后会自动激活并查询一次，新开窗口不用先点侧边栏。

```
⋯  ⊞  🔴 0  💳 ¥110.00
```

### 配置

1. 在 <https://platform.deepseek.com/api_keys> 创建一个 API Key
2. 填进设置项 `raccoon.deepseek.apiKey`（或者点状态栏上的「未配置」直接跳转）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `raccoon.deepseek.apiKey` | 空 | DeepSeek API Key。留空时状态栏显示「未配置」 |
| `raccoon.deepseek.refreshIntervalMinutes` | 10 | 自动刷新间隔（分钟），最小 1 |

用的是官方接口 `GET https://api.deepseek.com/user/balance`。

### 状态

| 显示 | 含义 |
| --- | --- |
| `💳 ¥110.00` | 正常 |
| `💳 ¥5.00`（黄底） | 余额低于 10（阈值是 `src/deepseek/statusBar.ts` 里的 `LOW_BALANCE_THRESHOLD`） |
| `💳 ¥0.00`（黄底） | `is_available` 为 false，后续 API 调用会被拒绝 |
| `⚠ 获取失败`（黄底） | 网络错误、Key 无效等，悬停看具体原因，点击重试 |
| `💳 未配置` | 还没填 Key，点击打开设置 |

## 俄罗斯方块

编辑器旁边开一局复古 CRT 风格（绿磷光 + 扫描线）的俄罗斯方块。侧边栏点「俄罗斯方块」，或命令面板搜 `Raccoon: 俄罗斯方块`。

### 操作

| 键 | 作用 |
| --- | --- |
| `←` `→` | 左右移动 |
| `↑` | 旋转 |
| `↓` | 软降（按住加速下落） |
| `Space` | 硬降 |
| `P` | 暂停 |
| `Enter` | 开始 / 重新开始 |

右侧面板显示 NEXT 预览、当前得分、最高分、等级、消行数。

### 最高分

存在 `context.globalState`（键 `raccoon.tetris.highScore`），跨窗口、跨会话保留。破纪录时会弹一条通知，并把新纪录回填到游戏面板的 BEST 里。

### 行为

- **单开一局。** 面板还开着时再点命令，只是把已有面板显示出来，不会并排出第二局。
- **切走再切回不丢进度。** 面板开了 `retainContextWhenHidden`，切到别的编辑器再切回来不会重开。

## 五子棋

编辑器旁边开一局人机对战的五子棋。侧边栏点「五子棋」，或命令面板搜 `Raccoon: 五子棋`。你执黑先行，任意方向连成五子即胜（长连也算）。

### 操作

| 键 | 作用 |
| --- | --- |
| 鼠标点击交叉点 | 落子（离交叉点太远不落） |
| `Z` | 悔棋：撤到「轮到你」为止（撤 AI 的白子 + 你的黑子，最多两步） |
| `Enter` | 重新开始 |

### 难度

下拉框随时切换，对正在进行的棋局立即生效：

| 难度 | AI 行为 |
| --- | --- |
| 简单 | 偏防守（进攻分打折），在得分前三的落点里随机 |
| 中等 | 攻防加权打分，在与最高分接近的一批落点里随机 |
| 困难 | 在中等的基础上往前看一层：模拟自己落子后对方的最强反击 |

三个难度共享一套底线反应，再简单也不会白给：自己立即成五直接收、对方一步成五必堵、自己能成活四直接做（两步内必赢）、对方要做活四必堵。

### 说明

- **AI 完全在网页里跑，纯 JS，无外部依赖。** 候选点打分 + 一层极小极大，整局实测最慢一手不到 1 毫秒，也不需要网络。
- **打分只认连续棋型**（活四、冲四、活三……），不认识跳子棋型（如 `X_XX`）。定位是休闲级对手：防守扎实、你露破绽它会赢，认真研究的玩家能赢它。
- **难度选择不持久化**，面板关闭重开后回到中等。
- 面板行为与俄罗斯方块一致：单开一局、切走再切回不丢棋。

## 贪吃蛇

编辑器旁边开一局复古 CRT 风格的贪吃蛇，外观和俄罗斯方块同一套机箱（绿磷光 + 扫描线）。侧边栏点「贪吃蛇」，或命令面板搜 `Raccoon: 贪吃蛇`。

24×20 的网格，蛇从中间往右出发。撞墙或撞到自己即结束，吃到食物加长一格。

### 操作

| 键 | 作用 |
| --- | --- |
| `←` `→` `↑` `↓` | 转向 |
| `W` `A` `S` `D` | 转向 |
| `Space` | 暂停 / 继续 |
| `P` | 暂停 / 继续 |
| `Enter` | 开始 / 重新开始 |

右侧面板显示当前得分、最高分、等级、长度。

### 得分与速度

每个食物 **10 分 × 当前等级**；每吃满 5 个食物升一级，每级快 10ms：

| 等级 | 每步间隔 |
| --- | --- |
| 1 | 200ms |
| 2 | 190ms |
| 5 | 160ms |
| 13 及以上 | 80ms（封顶） |

### 最高分

和俄罗斯方块一样存在 `context.globalState`（键 `raccoon.snake.highScore`），跨窗口、跨会话保留。破纪录时弹通知，并把新纪录回填到面板的 BEST 里。

### 一些细节

- **反向输入会被忽略**，不会掉头自杀。同一拍内连按两下（比如「上」接「左」）也不会拐错：方向先入队，每一拍取一个，队列最多存两拍。
- **贴着尾巴走不算死**——不吃食物时尾巴那一格会腾出来。但吃到食物变长的那一拍，尾巴不再让位，撞上就算死。
- **吃满整盘算通关**，遮罩显示 `PERFECT`。
- 面板行为与俄罗斯方块一致：单开一局、切走再切回不丢进度。

## 项目结构

| 位置 | 说明 |
| --- | --- |
| `src/extension.ts` | 入口，`activate` 里统一注册命令和视图 |
| `src/markdown/markdownToPdf.ts` | 转换核心：链接改写、HTML 模板、Chrome 探测、渲染 |
| `src/commands/exportPdf.ts` | 「导出为 PDF」命令：定位文件、解析输出路径、进度提示 |
| `src/deepseek/balance.ts` | 余额接口客户端：HTTP 请求、响应解析、金额格式化 |
| `src/deepseek/statusBar.ts` | 状态栏项：各状态渲染、定时刷新、配置变更响应 |
| `src/vscode/webviewPanel.ts` | 宿主侧 webview 加载：读 `dist` 产物、资源 URI 改写、CSP 注入 |
| `src/vscode/gamePanel.ts` | 游戏面板工厂：单例管理、最高分读写、消息协议处理，三个游戏共用 |
| `src/shared/protocol.ts` | webview ↔ 宿主消息协议（类型 + 消息名常量），两端共用——跨进程只能共享类型和纯常量 |
| `src/tetris/startGame.ts` | 俄罗斯方块入口：调面板工厂，只留通知文案 |
| `src/gomoku/startGomoku.ts` | 五子棋入口：调面板工厂（无消息、无最高分） |
| `src/snake/startSnake.ts` | 贪吃蛇入口：调面板工厂，只留通知文案 |
| `src/webviews/<game>/` | 各游戏网页（Vue 3 + TS）：`App.vue` 管流转、`components/` 管 Canvas 渲染、`logic/` 是纯逻辑引擎 |
| `src/webviews/shared/` | 网页侧共用：`Cabinet.vue`（CRT 机箱外壳）、`vscode.ts`（`acquireVsCodeApi` 封装，引用共享协议） |
| `tests/` | vitest 单元测试：三个游戏引擎 + DeepSeek / Markdown 纯函数 |
| `src/raccoonTreeDataProvider.ts` | 侧边栏功能入口列表，点击执行对应命令 |
| `vite.config.mts` | 三个游戏 webview 的多入口构建（`root: src/webviews` → `dist/webviews/<game>/`） |
| `resources/raccoon.png` | 商店图标（256×256 PNG） |
| `resources/raccoon.svg` | 活动栏图标（24×24 单色，随主题着色） |
| `.vscode/launch.json` | F5 调试配置，`preLaunchTask` 指向 `build` |
| `.vscode/tasks.json` | `build`（类型检查 + 打包）、`watch`（双 watcher 常驻监听）、`test`（跑测试）三个任务 |

## 开发

```bash
npm install
npm run compile       # 类型检查（宿主 + 网页 + 测试三份配置）+ 构建宿主 + 构建网页
npm run check-types   # 只做类型检查
npm run test          # 跑一遍全部 vitest 单元测试
npm run test:watch    # 测试常驻监听
npm run watch         # 宿主 + 三个游戏网页的双 watcher（concurrently）
npm run watch:types   # 只监听宿主类型检查
```

两条构建链各司其职：

- **宿主侧**：esbuild 把 `src/` 打成单文件 `out/extension.js`（外部依赖 `marked` 等一并打进 bundle，不进 VSIX 的 `node_modules`）。
- **网页侧**：Vite 把 `src/webviews/` 下三个游戏（Vue 3 + TS）以多入口打成 `dist/webviews/<game>/`。面板打开时由 `src/vscode/webviewPanel.ts` 读取产物、把资源路径改写成 `asWebviewUri` 并在 `<head>` 顶部注入 CSP（不含 `unsafe-inline`）。

`tsc` / `vue-tsc` 只做类型检查（`--noEmit`），宿主、网页、测试各有一份 tsconfig，互不包含。

### 调试（F5）

按 `F5` 会依次执行：类型检查 → 构建宿主 + 网页 → 启动「扩展开发宿主」窗口。类型错误会出现在「问题」面板里，可点击跳转到 `src/` 对应行。

配置在 `.vscode/` 下：`launch.json` 定义宿主窗口，`tasks.json` 定义 `build`、`watch`、`test` 三个任务。

想改代码后自动重新构建，手动启动 `watch` 任务（`Cmd+Shift+P` → 「Tasks: Run Task」→ `watch`），或直接在终端跑 `npm run watch`。**重建后需要在宿主窗口里按 `Cmd+R` 重载，然后重新打开面板**——重载后恢复的面板还是旧的 DOM，重新执行命令拿到的才是新构建产物。

改 `vite.config.mts` / `vitest.config.mts` 本身要重启 watch 进程（配置文件不会被监听热重载）。

## 打包

```bash
npm run package       # 产出 raccoon-0.1.0.vsix
```

打包脚本带了 `--allow-missing-repository`：项目还没有远程仓库，`package.json` 里暂时没有 `repository` 字段。发布到市场前把它补上，这个 flag 就可以去掉了。

## 已知约束

- **必须本机有 Chrome / Chromium / Edge。** 不像原脚本还能回退 weasyprint，插件里没有纯 JS 的 PDF 排版引擎可用。找不到浏览器时会提示去 `raccoon.pdf.chromePath` 指定路径。
- **不要给 Chrome 传 `--user-data-dir` 指向全新目录。** 实测（Chrome 152 / macOS）它会先写出 PDF 然后卡在退出阶段不返回；不带该参数时 1 秒多正常结束。代码里对此有注释，改动时留意。
- **DeepSeek API Key 是明文存在 settings.json 里的。** 这是刻意的选择（换编辑方便、可随设置同步），但要留意：别把它提交进 git、别出现在截图和录屏里。工作区级别的 `.vscode/settings.json` 也能设置它。
- **余额接口地址写死在代码里，没做成配置项。** 如果让它可配置，工作区里的 `.vscode/settings.json` 就能把请求指向第三方服务器，而请求头里带着 API Key。改动时别把它放开。
- **余额模块用 `https` 而非 `fetch`。** `engines.vscode` 是 `^1.75.0`，对应 Electron 19 / Node 16，**没有全局 `fetch`**。要换成 `fetch` 得先升 `engines`。
- `node_modules/marked-gfm-heading-id` 在 IDE 里可能报「找不到声明文件」。该包 `exports` 字段没写 `types` 条件，但顶层 `types` 字段有效，`tsc`（`module: commonjs`）能正常解析，不影响构建。
- **IDE 与命令行的 TypeScript 版本不一致。** VS Code 内置 TS 6.0.3 会自动加载 `@types`；项目的 TS 5.9.3 加载不到，会在编辑器里报一片 `找不到名称 "process"` / `"Buffer"`。tsconfig 里显式写了 `"types": ["node"]` 来解决。如果编辑器仍报错，跑一次「TypeScript: Restart TS Server」。
- **esbuild 的报错不会进「问题」面板。** 它的输出是「消息行 → 空行 → 位置行」，那个空行会打断 VS Code 逐行匹配的 problem matcher，没法可靠映射，所以 `watch` 任务没配 matcher。实际影响很小：esbuild 会报的错（模块解析失败、语法错误）`tsc --noEmit` 基本都会报，而 F5 走的 `build` 任务带 `$tsc` matcher，能正常显示。
- **别在 problemMatcher 里写 `$esbuild-watch`。** 它不是 VS Code 内置的（由 esbuild 的 VS Code 扩展提供），本地没装那个扩展时会报「未定义的 problem matcher」导致 F5 失败。
- **`npm run watch` 里的 esbuild watcher 在 stdin 关闭时会自动退出**，打印 `[watch] stopped automatically because stdin was closed`。正常终端里没事，但用 `&` 丢后台或重定向了 stdin 时会静默失效——看起来在跑，其实没监听。这种情况改用 `watch:host` 并加 `-- --watch=forever`。
- **网页侧模板禁止内联脚本/样式。** webview 的 CSP 已经收紧到不含 `unsafe-inline`：`<script>` 内容、`style=""` 属性都会被浏览器拦掉（白屏）。样式一律写进组件 `<style>` 块（Vite 会抽成外部 CSS 文件）；需要动态样式时用 CSS 变量或 class 切换。`src/webviews/shared/Cabinet.vue` 的插槽样式用 `:slotted()`，游戏专属样式留在各自组件里。
- **活动栏图标是 CSS mask，不是图片。** 这块查证过 VS Code 1.138 的实现：`toCompositeBarActionItem` 对扩展贡献的 SVG 图标生成 `mask: url(图标) no-repeat 50% 50%; mask-size: var(--activity-bar-icon-size, 24px)`，再用 `label.style.backgroundColor = <主题色>` 上色。也就是说**形状只取 SVG 的 alpha 通道，SVG 里 `fill` 写 `currentColor` 还是写死颜色都一样**；反过来，任何靠颜色区分的设计挪到这个位置都会退化成剪影。图标照 `resources/raccoon.svg` 的写法来：`width`/`height` + `viewBox="0 0 24 24"`、单条 `path`、`fill="currentColor"`、要做镂空就用 `fill-rule="evenodd"` 把子路径叠起来。
- **Vite 构建目标锁在 `chrome102`。** `engines.vscode` 是 `^1.75.0`，对应 Electron 19 / Chromium 102，而 Vite 8 默认 target 是 chrome111——`vite.config.mts` 里显式写了 `target: 'chrome102'` 和 `modulePreload.polyfill: false`（polyfill 会注入内联脚本，撞 CSP），改构建配置时别丢这两行。
- **游戏行为由 `tests/webviews/*` 钉死。** 三个游戏的引擎是从旧模板字符串逐行移植的，俄罗斯方块那份更是字节级恢复的代码——迁移时把行为 quirk 全部写进了测试（消行计分、踢墙序列、7-bag、`hardDrop` 的 `dist--`、贪吃蛇的贴尾判定等），改引擎前先跑 `npm test`，改动行为要同步改测试并想清楚为什么。

## 发布前

`package.json` 里的 `publisher` 还是占位值，记得改成你自己的；`name` / `displayName` 已定为 `raccoon` / `Raccoon`。`repository` 字段也还没填——补上真实仓库地址后，打包脚本里的 `--allow-missing-repository` 可以去掉，本文件的表格也可以换回相对路径的 Markdown 链接。
