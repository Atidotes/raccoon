# Raccoon

一只住在编辑器里的浣熊，喜欢翻代码垃圾桶，把游戏、办公和小工具都叼回来给你。VS Code 与 Visual Studio 2022 都能装（同一份前端，两套宿主，见「Visual Studio 版」）。目前六个功能：

- **Markdown 导出 PDF** —— 纯 JS 实现，不需要本机 Python 环境
- **DeepSeek 余额** —— 在状态栏实时显示账户余额
- **SSH 连接** —— 在编辑器区域管理服务器，开多标签内嵌终端
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

## SSH 连接

侧边栏点「SSH 连接」（或命令面板搜 `Raccoon: SSH 连接`），在编辑器区域打开面板：打开后默认是服务器列表主页，点任意一台整页切换成全屏终端。终端是 xterm.js，连接由扩展宿主里的 ssh2 建立——不占用 VS Code 自带终端，也不需要本机装 `ssh` 命令。

### 用法

1. 主页点「+ 新增服务器」，填名称（只给你自己看的标签）、主机、端口、用户名和认证方式
2. 表单底部左侧的「测试连接」可以先用当前填写的内容（含还没保存的密码）试连一次，通了再保存——测试只验证握手和登录，不开终端
3. 点任意一张服务器卡片即连接，整个页面切换到全屏终端；一台服务器对应一个标签，主页卡片上的状态点显示它当前是连接中 / 已连接 / 已断开
4. 终端页左上角的 `←` 返回服务器列表，**连接保持不断**；主页顶部的「回到终端」或再点同一台机器，都会切回原来的终端而不是重开一条
5. 终端页顶部是多标签：可以同时连着好几台机器来回切
6. 连接失败时终端上方会出现一条红色横幅写清原因；关掉标签或关掉整个面板，对应的连接会一起断掉，不留后台会话

主机地址支持域名、IPv4 和 IPv6。IPv6 用 `[::1]` 这种带方括号的写法更不容易看错，代码里会在连接前把方括号去掉。

### 认证方式

| 方式 | 怎么填 | 密钥存哪 |
| --- | --- | --- |
| 密码 | 填登录密码 | 系统钥匙串 |
| 私钥文件 | 填私钥**路径**（如 `~/.ssh/id_ed25519`）+ 有的话填 passphrase | passphrase 进系统钥匙串，私钥本身不复制不保存 |
| ssh-agent | 一般不用填，默认读环境变量 `SSH_AUTH_SOCK`（Windows 是命名管道 `\\.\pipe\openssh-ssh-agent`） | 不涉及 |

从 Dock / 启动台启动的 VS Code 有可能读不到 `SSH_AUTH_SOCK`（拿不到登录 shell 的环境变量）。这种情况在服务器配置里手动填上 agent socket 路径即可，macOS 上一般是 `/private/tmp/com.apple.launchd.XXXX/Listeners`。

### 密码存在哪

服务器清单（名称 / 主机 / 端口 / 用户名）存的是 VS Code 的 **globalState**，跨项目共用一份；密码和私钥 passphrase 存 **SecretStorage**，在 macOS 上是钥匙串、Windows 上是凭据管理器、Linux 上是 libsecret。

两者都不写进工作区的 `.vscode/settings.json`。这是刻意的：工作区设置通常会跟着 git 走，一份带主机名和用户名的服务器清单跟着仓库推到远端，等于白送一张内网地图。密码则更进一步，连 globalState 那个明文 JSON 文件都不落。

表单里的密码框**永远不会回显已存的密码**——宿主根本不把明文发给网页那侧，只发一个「存过没有」的标记。所以编辑服务器时密码框留空 = 不修改，填了才覆盖。想彻底清掉某个密码，把这条记录删掉重加。

### 主机指纹

ssh2 默认**完全不校验主机密钥**，链路被劫持时攻击者用自己的密钥照样能握手成功。插件补了一道 TOFU（首次连接即信任）：第一次连某台机器时记下它主机密钥的 SHA256 指纹（`SHA256:...`，和 `ssh-keygen -lf` 的输出格式一致，可以直接和运维给的指纹对照），之后每次连接都必须一致，不一致就断开并提示可能存在中间人攻击。

指纹按 `主机:端口` 存。挡不住「第一次连的时候就已经被劫持」——这是 TOFU 的固有边界——但之后任何一次密钥替换都会被发现。如果那台机器确实重装过系统或换了密钥，把这条服务器记录删掉重加就会重新信任。

### 已知限制

- **不支持 keyboard-interactive（PAM / 二次验证）。** 只走密码、公钥、agent 三种认证。开了 2FA 的机器连不上。
- **不做端口转发、SFTP、会话录制。** 就是个终端。
- **只有一套指纹库，不读 `~/.ssh/known_hosts`。** 用系统 `ssh` 连过并记下的指纹，这里不认识，第一次连仍然算「首次信任」。

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

## Visual Studio 版

同一份前端产物也打包成 Visual Studio 2022 扩展。两个平台的插件体系是两套运行时，**宿主侧各写一份**，但网页侧完全复用：

```
VS Code 版                                Visual Studio 版
─────────────────────────                 ──────────────────────────────
TS 宿主 out/extension.js                  C# 宿主 src/visualstudio/RaccoonVS/
  ├ ssh2 / SecretStorage                    ├ SSH.NET / DPAPI
  ├ https / 状态栏                          ├ HttpClient / IVsStatusbar
  └ marked + 外挂 Chrome 出 PDF              └ Markdig + WebView2 PrintToPdfAsync
                    ↓                                    ↓
            前端 dist/webviews/<app>/（同一份构建产物、同一套消息协议）
             桥  acquireVsCodeApi              桥  window.chrome.webview
```

前端只跟宿主通过 `postMessage` + JSON 打交道，所以 `src/webviews` 一行代码都没分叉：`src/webviews/shared/vscode.ts` 里探测一下 `chrome.webview`，两个宿主就都能跑。消息名与字段在 `src/shared/protocol.ts` 和 `src/visualstudio/RaccoonVS/Protocol.cs` 两侧对照实现。

功能对应关系：Tools 菜单下的「Raccoon」子菜单给出 SSH 连接 / 三个游戏 / 导出 PDF / 刷新余额六个命令，都是**工具窗口**（不是编辑器标签页）。

### 用起来

需要 **Visual Studio 2022（17.x，任意 SKU）**。装 vsix 即可，扩展自带 WebView2 SDK，运行时由 VS 安装程序保证（2022 强制预装）。

### 与 VS Code 版的差异

| 方面 | 差异 |
| --- | --- |
| ssh-agent 认证 | **不支持。** SSH.NET 官方没有 agent 支持，第三方的 `SshNet.Agent` 有已知 bug（ED25519 密钥损坏、agent 未启动时死锁）。选它会给个明确的提示，密码和私钥文件两种方式不受影响 |
| 密码存储 | `%APPDATA%\RaccoonVS\secrets.dat`，用 DPAPI（CurrentUser）加密，等价于 VS Code 版的 SecretStorage |
| 服务器清单 | `%APPDATA%\RaccoonVS\servers.json`，不含任何密钥 |
| 最高分 | `%APPDATA%\RaccoonVS\high_scores.json` |
| DeepSeek 配置 | `%APPDATA%\RaccoonVS\settings.json`（VS 版没有「工作区设置」这一套） |
| 游戏结束提示 | 写状态栏而不是弹窗——不想为一个游戏提示弹模态框打断人 |
| 主题同步 | WebView2 的 `prefers-color-scheme` 跟的是 Windows 主题而不是 VS 主题，所以由宿主读 `VSColorTheme` 后主动下发。换主题后重开一次面板生效（没订阅 shell 的广播消息，见下文） |
| 导出 PDF | 不需要本机 Chrome，用 WebView2 的 `PrintToPdfAsync` |

### 构建

**只能在 Windows 上打包**（VSSDK 的 `vsct.exe` 是 Windows 可执行文件）。需要 VS 2022 装了「Visual Studio 扩展开发」工作负载（`Microsoft.VisualStudio.Component.VSSDK`），它同时带来 .NET Framework 4.8 的 targeting pack。

```powershell
npm ci
npm run compile        # 必须先跑：compile 里的 clean 会删 dist，而 msbuild 要靠 dist/webviews 打进 vsix
npm run build:vs       # = dotnet msbuild src/visualstudio/RaccoonVS.sln -restore -p:Configuration=Release
```

产物在 `src/visualstudio/RaccoonVS/bin/Release/RaccoonVS.vsix`。

**构建顺序不能反。** `npm run compile` 里的 `clean` 会删掉 `dist/`，而 msbuild 阶段要靠 `dist/webviews/**` 打进 vsix——先打包再编译的话，打出来的 vsix 里一个前端产物都没有，装上去面板是空白。

**装之前先自检 vsix 内容。** 有两样东西缺了都表现为「面板打不开」，但原因完全不同：

```powershell
tar -tf src/visualstudio/RaccoonVS/bin/Release/RaccoonVS.vsix | Select-String "WebView2Loader|dist/webviews"
```

- `runtimes/win-x64/native/WebView2Loader.dll` —— 缺了 WebView2 初始化失败。这个文件在 csproj 里是显式链接进 vsix 的（NuGet 按 RID 约定布局，VSSDK 的默认收集不保证会算进来），路径由 NuGet 解析，升级 WebView2 包版本时不用改。
- `dist/webviews/<app>/index.html` 四个 —— 缺了说明构建顺序反了。

**安装**：关掉 VS，双击 vsix 按提示装（或 `VSIXInstaller.exe /q <路径>`）；装的时候 VS 必须是关闭状态，否则要重启。

**版本号**由 CI 通过 `-p:VsixVersion=1.2.3.0` 注入（取 `package.json` 的 `version` 补成四段）；本地直接 build 时 csproj 里的占位值是 `0.1.0.0`。装了新版会覆盖旧版，但**已经打开的 VS 实例不会热加载**——验证新包前把 VS 全关掉再装。

### 不用 Windows 时的替代验证

推 GitHub 后由 `.github/workflows/build-vs.yml` 承担编译验证与打包：固定 `windows-2022` 镜像（自带 VS 2022 Enterprise + VisualStudioExtension 工作负载，不用现装工具链），vswhere 定位 MSBuild，打完包解开 vsix 自检上面那两样。**这个 workflow 的主要职责就是「能不能编过」**——没有 Windows 机器时它是唯一的真实反馈，第一轮大概率还要修几处 API 用法。

本机（macOS）能做的两件事：用 SDK 风格的临时工程引同一批 `.cs` 文件抓 API 与语法错误（`net48` + `Microsoft.NETFramework.ReferenceAssemblies`）；对拿不准的 API，用 `MetadataLoadContext` 反射目标 dll 把签名打出来确证——`ToolWindowPane.Frame` 声明类型其实是 `object` 这类事就是这么发现的。两种办法都没法替代真机运行。

## 项目结构

| 位置 | 说明 |
| --- | --- |
| `src/extension.ts` | 入口，`activate` 里统一注册命令和视图 |
| `src/markdown/markdownToPdf.ts` | 转换核心：链接改写、HTML 模板、Chrome 探测、渲染 |
| `src/commands/exportPdf.ts` | 「导出为 PDF」命令：定位文件、解析输出路径、进度提示 |
| `src/deepseek/balance.ts` | 余额接口客户端：HTTP 请求、响应解析、金额格式化 |
| `src/deepseek/statusBar.ts` | 状态栏项：各状态渲染、定时刷新、配置变更响应 |
| `src/ssh/servers.ts` | 服务器清单读写：非敏感字段进 globalState，密码 / passphrase 进 SecretStorage |
| `src/ssh/sessionManager.ts` | ssh2 会话池：建连、申请 pty、双向搬字节、把英文报错翻成中文 |
| `src/ssh/knownHosts.ts` | TOFU 主机指纹：首次记下 SHA256，之后再连必须一致，否则拒绝 |
| `src/ssh/validate.ts` | 主机 / 端口 / 表单校验的纯函数。宿主侧才是权威，webview 传来的值一律不可信 |
| `src/ssh/terminalPanel.ts` | SSH 面板：单例、消息路由；`startSsh.ts` 是命令入口的薄封装 |
| `src/webviews/ssh/` | SSH 网页（Vue 3 + TS）：`xterm.ts` 建终端、`components/` 管标签与表单、`logic/sessions.ts` 是纯标签状态机 |
| `src/vscode/webviewPanel.ts` | 宿主侧 webview 加载：读 `dist` 产物、资源 URI 改写、CSP 注入 |
| `src/vscode/gamePanel.ts` | 游戏面板工厂：单例管理、最高分读写、消息协议处理，三个游戏共用 |
| `src/shared/protocol.ts` | webview ↔ 宿主消息协议（类型 + 消息名常量），两端共用——跨进程只能共享类型和纯常量 |
| `src/tetris/startGame.ts` | 俄罗斯方块入口：调面板工厂，只留通知文案 |
| `src/gomoku/startGomoku.ts` | 五子棋入口：调面板工厂（无消息、无最高分） |
| `src/snake/startSnake.ts` | 贪吃蛇入口：调面板工厂，只留通知文案 |
| `src/webviews/<game>/` | 各游戏网页（Vue 3 + TS）：`App.vue` 管流转、`components/` 管 Canvas 渲染、`logic/` 是纯逻辑引擎 |
| `src/webviews/shared/` | 网页侧共用：`Cabinet.vue`（CRT 机箱外壳）、`vscode.ts`（双宿主通信封装）、`theme.css`（`--vscode-*` 变量的兜底调色板） |
| `src/visualstudio/RaccoonVS/` | Visual Studio 版宿主（C#，net48 + VSSDK），见下一行起的细分 |
| ↳ `WebViewPanelHost.cs` | 内嵌 WebView2 的面板宿主：虚拟主机映射 `raccoon.test`、消息双向转发、线程兜底 |
| ↳ `WebViewToolWindow.cs` | 工具窗口基类：主题取色下发、消息组装、关闭清理 |
| ↳ `RaccoonVSPackage.cs` / `Commands.vsct` | 包入口与命令表（Tools → Raccoon 子菜单）；命令 id 两侧必须一致 |
| ↳ `Ssh/` | SSH 连接层，逐文件对应到 `src/ssh/`（`SshSessionManager` / `SshServerStore` / `SshKnownHosts` / `SshValidate` / `SshTypes`） |
| ↳ `Games.cs` | 三个游戏的工具窗口（VS 的工具窗口是单实例 Frame，所以一个游戏一个类型），共用一套消息路由 |
| ↳ `Pdf/` | `ExportPdfCommand.cs` 取活动文档 + Markdig 渲染 + `PrintToPdfAsync`；`LinkRewriter.cs` 对应 `markdownToPdf.ts` 的链接改写 |
| ↳ `DeepSeek/BalanceService.cs` | 余额定时查询与状态栏显示 |
| ↳ `Storage.cs` | `%APPDATA%\RaccoonVS` 下的原子 JSON 存储 + DPAPI 密钥存储 |
| ↳ `Protocol.cs` | 消息名常量与信封类型（含 `[JsonExtensionData]` 的兜底字段），对照 `src/shared/protocol.ts` |
| ↳ `VsShell.cs` | 确认对话框与状态栏的一层薄封装（取不到服务就降级，不抛） |
| `tests/` | vitest 单元测试：三个游戏引擎 + DeepSeek / Markdown / SSH 纯函数 |
| `src/raccoonTreeDataProvider.ts` | 侧边栏功能入口列表，点击执行对应命令 |
| `vite.config.mts` | 三个游戏 + SSH 四个 webview 的多入口构建（`root: src/webviews` → `dist/webviews/<app>/`） |
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
npm run watch         # 宿主 + 网页的双 watcher（concurrently）
npm run watch:types   # 只监听宿主类型检查
```

两条构建链各司其职：

- **宿主侧**：esbuild 把 `src/` 打成单文件 `out/extension.js`（`marked` 这类纯 JS 依赖一并打进 bundle，不进 VSIX 的 `node_modules`）。`ssh2` 是唯一的例外，走 `--external` 保留成 `require('ssh2')`，运行时从 `node_modules` 加载。
- **网页侧**：Vite 把 `src/webviews/` 下的应用（Vue 3 + TS）以多入口打成 `dist/webviews/<app>/`。面板打开时由 `src/vscode/webviewPanel.ts` 读取产物、把资源路径改写成 `asWebviewUri` 并在 `<head>` 顶部注入 CSP。

`tsc` / `vue-tsc` 只做类型检查（`--noEmit`），宿主、网页、测试各有一份 tsconfig，互不包含。

### 调试（F5）

按 `F5` 会依次执行：类型检查 → 构建宿主 + 网页 → 启动「扩展开发宿主」窗口。类型错误会出现在「问题」面板里，可点击跳转到 `src/` 对应行。

配置在 `.vscode/` 下：`launch.json` 定义宿主窗口，`tasks.json` 定义 `build`、`watch`、`test` 三个任务。

想改代码后自动重新构建，手动启动 `watch` 任务（`Cmd+Shift+P` → 「Tasks: Run Task」→ `watch`），或直接在终端跑 `npm run watch`。**重建后需要在宿主窗口里按 `Cmd+R` 重载，然后重新打开面板**——重载后恢复的面板还是旧的 DOM，重新执行命令拿到的才是新构建产物。

改 `vite.config.mts` / `vitest.config.mts` 本身要重启 watch 进程（配置文件不会被监听热重载）。

## 打包

```bash
npm run package       # VS Code 版：产出 raccoon-0.1.0.vsix
npm run package:vs    # Visual Studio 版：npm 构建 + MSBuild 打包（只能在 Windows 上跑）
```

`package.json` 的 `repository` 已填成真实地址，`vsce` 不再提示需要 `--allow-missing-repository`。换仓库地址时这里要同步。

Visual Studio 版的详细构建步骤与产物路径见上面「Visual Studio 版 → 构建」。

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
- **CSP 放宽只对 SSH 面板，别顺手扩大到别的应用。** xterm.js 的 DOM 渲染器要往 `<head>` 里插 `<style>` 元素（字符测量、尺寸样式），所以 `style-src` 对它单独放开了 `'unsafe-inline'`。这份名单在 `src/vscode/webviewPanel.ts` 的 `INLINE_STYLES_APPS` 里按应用名列出。`script-src` 对所有应用仍然没有 `unsafe-inline`，`default-src 'none'` 也照样挡死所有出站请求——放开的只是「页面内联样式」，不是「能执行任意脚本」。
- **`.vscodeignore` 不是 gitignore 语义，而 `ssh2` 的打包全靠它。** 宿主构建里 ssh2 是 `--external:ssh2`，运行时从 `node_modules` 加载，所以包里必须有它。vsce 按 `package.json` 的 `dependencies` 自动收整棵生产依赖树（`ssh2` / `asn1` / `safer-buffer` / `bcrypt-pbkdf` / `tweetnacl`；`cpu-features` 和 `nan` 是 `optionalDependencies`，不会被带上），**但收完还要拿 `.vscodeignore` 过滤一遍**，而那个过滤是 vsce 自己实现的：非 `!` 开头的是 ignore，`!` 开头的是 negate，命中 negate 就保留，**没有 gitignore 那条「父目录被排除就不能再放回子文件」的规则**。
    - 踩过的坑：本文件里写着 `node_modules/**`，再配上几条 `!node_modules/<依赖>/**` 白名单才收得回来。曾经因为误判成 gitignore 语义、以为白名单无效而把它删掉，结果打出来的 vsix 里 `node_modules` 是空的（23 个文件 / 213KB），装上后一开 SSH 面板就是 `Cannot find module 'ssh2'`。**改 `.vscodeignore` 之后务必 `unzip -l` 数一下包里的 `node_modules`**，别只看「打包成功」。
    - 同理，在同一份 negate 底下没法再排掉子目录，所以 ssh2 是按 `lib/**/*.js`、`util/**`、`package.json` 三条正面列出来的——顺带把 node-gyp 编出来的 `build/`（830KB 中间产物和一个 ABI 不对的 `.node`）和 `test/`、`examples/`（620KB）挡在包外。`.vscodeignore` 里有详细注释。
- **没有原生加密加速，走的是纯 JS 实现。** ssh2 的 install 脚本会在构建机上编一个 `sshcrypto.node`，那个二进制是按构建机的 Node ABI 编的，在 Electron 里 `require` 必然失败。这段 require 被 ssh2 自己用空 `try/catch` 包着（`lib/protocol/crypto.js`），失败后静默回退到纯 JS 加密，**功能完全一样，只是握手和吞吐慢一些**。那个 `.node` 和 `cpu-features` 都没打进包（见上一条），所以这条回退路径在本地和用户机器上都是必走的。
- **活动栏图标是 CSS mask，不是图片。** 这块查证过 VS Code 1.138 的实现：`toCompositeBarActionItem` 对扩展贡献的 SVG 图标生成 `mask: url(图标) no-repeat 50% 50%; mask-size: var(--activity-bar-icon-size, 24px)`，再用 `label.style.backgroundColor = <主题色>` 上色。也就是说**形状只取 SVG 的 alpha 通道，SVG 里 `fill` 写 `currentColor` 还是写死颜色都一样**；反过来，任何靠颜色区分的设计挪到这个位置都会退化成剪影。图标照 `resources/raccoon.svg` 的写法来：`width`/`height` + `viewBox="0 0 24 24"`、单条 `path`、`fill="currentColor"`、要做镂空就用 `fill-rule="evenodd"` 把子路径叠起来。
- **Vite 构建目标锁在 `chrome102`。** `engines.vscode` 是 `^1.75.0`，对应 Electron 19 / Chromium 102，而 Vite 8 默认 target 是 chrome111——`vite.config.mts` 里显式写了 `target: 'chrome102'` 和 `modulePreload.polyfill: false`（polyfill 会注入内联脚本，撞 CSP），改构建配置时别丢这两行。
- **游戏行为由 `tests/webviews/*` 钉死。** 三个游戏的引擎是从旧模板字符串逐行移植的，俄罗斯方块那份更是字节级恢复的代码——迁移时把行为 quirk 全部写进了测试（消行计分、踢墙序列、7-bag、`hardDrop` 的 `dist--`、贪吃蛇的贴尾判定等），改引擎前先跑 `npm test`，改动行为要同步改测试并想清楚为什么。

### Visual Studio 版特有

- **`window.chrome` 在 VS Code 里也存在。** Electron 会给页面注入 `window.chrome`（只是没有 `webview` 属性），所以双宿主探测必须写成 `chrome?.webview`，只判断 `chrome` 会把 VS Code 误判成 WebView2，SSH 面板直接收不到宿主消息。改 `src/webviews/shared/vscode.ts` 时留意这条。
- **WebView2 的消息事件打在 `chrome.webview` 上，不是 `window`。** 这是两个宿主唯一一处结构性差异，已经由 `onHostMessage()` 吃掉；`event.data` 两边都是已解析的对象（C# 侧恒用 `PostWebMessageAsJson`）。
- **前端产物必须走虚拟主机映射（`https://raccoon.test/<app>/`），不能直接开 `file://`。** `file://` 的 null origin 会让 `type="module"` 直接被拦，Vite 产物是 ES module，用文件路径打不开。域名用 `.test`（RFC 6761 保留）而不是 `.local`（会和 mDNS 打架），映射每次 `CoreWebView2` 重建都要重设——它是实例级的。
- **CSP 靠派生一份 `index.host.html` 注入，两条更「正统」的路都走不通。** 想拦响应补 CSP 头：能改写响应的 `WebResourceRequested` 拿到的是已构造好的响应，读不到响应体；能读体的 `WebResourceResponseReceived` 又只能看不能改。想用 `NavigateToString` 注入 `<meta>`：那样文档是不透明源，页面里的 ES module 请求会被判成跨源，连同源的虚拟主机都拉不下来。所以是在 `index.html` 旁边派生一份注入了 `<meta>` 的副本，仍按 URL 从虚拟主机装载——源和相对路径解析都与原文件一致。派生文件只在内容对不上时重写，构建产物本身不动。
- **`ToolWindowPane.Frame` 在 `Microsoft.VisualStudio.Shell.15.0` 里声明的类型是 `object`，不是 `IVsWindowFrame`。** 想调 `Show()` 必须自己转一次；直接 `.Frame?.Show()` 编不过。
- **`CanTrust` 默认是 `true`。** 主机密钥校验的 handler 里不显式置 `false` 就等于零校验——这个默认值的方向很反直觉，`SshSessionManager.BuildClient` 里有注释。
- **碰 VS 服务前必须切回 UI 线程，且这条不能靠调用方自觉。** `IVsStatusbar`、`IVsWindowFrame`、`DTE`、WebView2 都是 UI 线程专属，而调用方遍布各处（SSH 读取线程、余额轮询、WPF 的 `Loaded`）。统一在 `VsShell.Status()` 和 `WebViewPanelHost.PostRaw()` 里兜住线程，别在调用点假设自己在哪条线程上。`async void` 只允许出现在 WPF 的事件处理器上，且方法体要全程 try/catch——漏出去的异常是进程级崩溃。
- **没订阅 shell 的主题广播消息。** `IVsUIShell` 的广播要自己实现 `IVsBroadcastMessageEvents` 再拿 cookie，接口在 17.x 还挪过位置，为一个「锦上添花」的刷新去赌它不划算。现状是面板每次打开都重新下发主题，用户换完主题重开一次面板即可。
- **`LICENSE` 没有扩展名，vsix 里要改名成 `LICENSE.txt`。** vsixmanifest 的 `<License>` 靠扩展名判定格式，所以 csproj 里用 `<Link>LICENSE.txt</Link>` 换名打进包。
- **不要给工具窗口设 `BitmapResourceID`。** 项目里没有图标条（`.vsct` 里也没有 `<Bitmaps>`），指过去只会让 VS 找不到资源。不设时用默认图标，四个面板靠 `Caption` 区分。

## 发布前

`package.json` 里的 `publisher` 还是占位值，记得改成你自己的；`name` / `displayName` 已定为 `raccoon` / `Raccoon`，`repository` 已填。本文件的表格用的是代码路径而不是 Markdown 链接，仓库公开后可以换回相对路径链接。

**`categories` 只能是 VS Code 内置的这 20 个值**（源码里是 `ExtensionCategory` 的枚举，`toLowerCase` 比较，所以大小写无所谓，但值本身不存在就是不认）：

```
AI  Azure  Chat  Data Science  Debuggers  Education  Extension Packs  Formatters
Keymaps  Language Packs  Linters  Machine Learning  Notebooks  Other
Programming Languages  SCM Providers  Snippets  Testing  Themes  Visualization
```

**没有 `Games`，也没有 `Productivity`** —— 写这两个值 IDE 会报 `Value is not accepted. Valid values: ...`，`vsce package` 不报错但市场上也不会认。游戏类和办公类的插件在市场上都归在 `Other` 下，搜索曝光靠的是自由文本的 `keywords`（本项目的 `games` / `游戏` / `productivity` / `办公` / `摸鱼` 已经覆盖）。所以这里最终只留了 `["Other"]`。
