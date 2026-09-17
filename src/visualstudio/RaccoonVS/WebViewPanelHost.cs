using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RaccoonVS
{
    /// <summary>
    /// 内嵌 WebView2 的面板宿主，四个 webview 应用（三个游戏 + SSH）共用。
    ///
    /// 与 VS Code 版的对应关系：
    ///   acquireVsCodeApi().postMessage  ←→  PostWebMessageAsJson
    ///   window 上的 message 事件         ←→  WebMessageReceived
    ///   asWebviewUri                     ←→  虚拟主机映射 raccoon.test
    ///
    /// 前端产物是同一份（dist/webviews），协议也是同一套（见 Protocol.cs）。
    /// </summary>
    public class WebViewPanelHost : UserControl
    {
        /// <summary>
        /// 虚拟主机名。用 .test（RFC 6761 保留域名）而不是 .local——后者可能与 mDNS 冲突。
        /// 必须走 https 形式加载：file:// 的 null origin 会挡掉 type="module"，
        /// Vite 产物是 ES module，直接用文件路径打不开。
        /// </summary>
        private const string VirtualHost = "raccoon.test";

        /// <summary>
        /// 往页面里插的 CSP。与 VS Code 版（src/vscode/webviewPanel.ts）保持一致，
        /// 只有 style-src 一处不同：xterm.js 的 DOM 渲染器要往 <head> 里插 <style>
        /// 元素，没有 unsafe-inline 终端会排版全乱，所以只给 ssh 应用放开。
        ///
        /// 前端产物全在本地，default-src 'none' 挡死所有出站请求；放开内联样式
        /// 带不出数据，最坏是面板内部的视觉欺骗。
        /// </summary>
        private const string CspBase =
            "default-src 'none'; " +
            "script-src 'self'; " +
            "style-src 'self'";

        private static readonly string[] InlineStyleApps = { "ssh" };

        /// <summary>
        /// 全扩展共用一个 CoreWebView2Environment，环境数据目录显式指到 %LOCALAPPDATA%。
        ///
        /// 不显式指的下场是 E_ACCESSDENIED（0x80070005）：WebView2 的默认用户数据目录
        /// 是「宿主 exe 目录 + .exe.WebView2 后缀」，宿主是 devenv.exe 时就是
        /// C:\Program Files\...\Common7\IDE\devenv.exe.WebView2——普通用户写不了，
        /// EnsureCoreWebView2Async 直接拒绝访问。这也是为什么同一份代码在 VS Code
        /// 版上没事（宿主进程目录可写）、进 VS 就炸。
        ///
        /// 环境必须只建一次、全局复用：同一个用户数据目录同时挂两个环境会互相打架，
        /// 所以建环境的路径加了门闩串行化；建好之后多个面板共用是官方支持的用法。
        /// </summary>
        private static readonly SemaphoreSlim EnvironmentGate = new SemaphoreSlim(1, 1);
        private static CoreWebView2Environment _environment;

        private readonly string _app;
        private readonly WebView2 _webView;
        private bool _ready;

        /// <summary>CoreWebView2 就绪（虚拟主机映射、消息通道都已挂上）。</summary>
        public event EventHandler Ready;

        /// <summary>收到 webview 的消息。已在 UI 线程上。</summary>
        public event EventHandler<Envelope> MessageReceived;

        public WebViewPanelHost(string app)
        {
            _app = app;
            _webView = new WebView2
            {
                HorizontalAlignment = System.Windows.HorizontalAlignment.Stretch,
                VerticalAlignment = System.Windows.VerticalAlignment.Stretch,
                // 先藏起来：WebView2 在布局完成前会以 0x0 尺寸初始化，
                // 之后再显示会出现撕裂的白块。等 SizeChanged 拿到真实尺寸再显示。
                Visibility = System.Windows.Visibility.Collapsed
            };

            Content = _webView;
            SizeChanged += OnSizeChanged;
            Loaded += OnLoaded;
        }

        private static async Task<CoreWebView2Environment> GetEnvironmentAsync()
        {
            if (_environment != null)
            {
                return _environment;
            }

            await EnvironmentGate.WaitAsync();
            try
            {
                if (_environment == null)
                {
                    // LOCALAPPDATA 放这种缓存类数据比 APPDATA 合适：不进漫游。
                    var userData = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "RaccoonVS", "WebView2");
                    Directory.CreateDirectory(userData);

                    // browserExecutableFolder 传 null：让 WebView2 用系统安装的 Evergreen
                    // Runtime（VS 2022 起安装程序强制带），不打包私有运行时。
                    _environment = await CoreWebView2Environment.CreateAsync(null, userData, null);
                }
                return _environment;
            }
            finally
            {
                EnvironmentGate.Release();
            }
        }

        /// <summary>把消息发给 webview。可在任意线程调用。</summary>
        public void Post(JObject message)
        {
            PostRaw(message.ToString(Formatting.None));
        }

        /// <summary>把消息发给 webview。可在任意线程调用。</summary>
        public void PostRaw(string json)
        {
            var core = _webView.CoreWebView2;
            if (core == null)
            {
                // 面板还没初始化完或已经销毁，消息没有去处
                return;
            }

            // WebView2 是 STA 组件，跨线程调用必须回到 UI 线程。
            // 大多数调用方（Ssh 的读取线程、余额轮询）都不在 UI 线程上，所以这里由宿主兜住。
            ThreadHelper.JoinableTaskFactory.Run(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    core.PostWebMessageAsJson(json);
                }
                catch (Exception)
                {
                    // 面板正在销毁时可能抛错，没有可收拾的
                }
            });
        }

        private void OnSizeChanged(object sender, System.Windows.SizeChangedEventArgs e)
        {
            if (e.NewSize.Width > 0 && e.NewSize.Height > 0)
            {
                _webView.Visibility = System.Windows.Visibility.Visible;
            }
        }

        // WPF 的 Loaded 事件处理器只能是 async void；方法体里每一步都自己接了异常，
        // 不会让未捕获的异常冒到进程级。
#pragma warning disable VSTHRD100
        private async void OnLoaded(object sender, System.Windows.RoutedEventArgs e)
#pragma warning restore VSTHRD100
        {
            Loaded -= OnLoaded;

            try
            {
                await _webView.EnsureCoreWebView2Async(await GetEnvironmentAsync());
            }
            catch (Exception error)
            {
                // 数据目录已经显式指到 %LOCALAPPDATA%，再走到这里只剩两种情况：
                // 运行时缺失（被组策略屏蔽的机器），或运行时的其他故障。
                // 给一句能看懂的提示，别让面板一片空白。
                ShowFailure(error.Message,
                    "WebView2 初始化失败。请确认已安装 Microsoft Edge WebView2 Runtime（VS 2022 起默认安装）。");
                return;
            }

            // async void 里再往上抛就是进程级崩溃，后面每一步都得自己兜住
            try
            {
                var core = _webView.CoreWebView2;

                // 每次 CoreWebView2 重建（窗口重开、VS 重启）都要重设映射，它是实例级的。
                // 两参重载的默认访问级别是 DenyCors，这里显式写出来：同源的 module 加载
                // 不受 CORS 影响（Vite 产物正是这种情况），要放开给外部 API 再改 Allow。
                //
                // 映射根必须是 dist/webviews（各 app 的**父目录**），不是 app 目录：
                // 构建产物的 index.html 里引用的是 ../assets/xxx（Vite 相对路径指向
                // 共享的 assets 目录）。根指到 app 目录的话，页面 URL 里的 /<app>/ 段
                // 会先在文件系统里多叠一层——直接 ERR_FILE_NOT_FOUND，而 assets 引用
                // 也解析不到父目录里去。页面 URL 见 Navigate。
                core.SetVirtualHostNameToFolderMapping(
                    VirtualHost,
                    ResolveWebviewsDirectory(),
                    CoreWebView2HostResourceAccessKind.DenyCors);

                core.WebMessageReceived += OnWebMessageReceived;
                Navigate(core);
            }
            catch (Exception error)
            {
                ShowFailure(error.Message, null);
                return;
            }

            _ready = true;
            Ready?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// 装载页面。
        ///
        /// 不走「虚拟主机直出 index.html + 拦截响应补 CSP 头」那条路：能改写响应的
        /// WebResourceRequested 拿到的是已经构造好的响应，读不到响应体；能读体的
        /// WebResourceResponseReceived 又只能看不能改。也不走 NavigateToString：
        /// 那样文档是不透明源，页面里的 ES module 请求会被判成跨源，连同源的
        /// https://raccoon.test 都拉不下来。
        ///
        /// 改用的办法是在 index.html 旁边派生一份注入了 CSP 的副本，仍然从虚拟主机
        /// 按 URL 装载——源和相对路径解析都与原文件一致，只是多了一个 meta CSP。
        /// 派生文件只在内容对不上时重写，构建产物本身不动。
        /// </summary>
        private void Navigate(CoreWebView2 core)
        {
            var directory = ResolveAppDirectory();
            var source = Path.Combine(directory, "index.html");
            var html = File.ReadAllText(source, Encoding.UTF8);

            if (html.IndexOf("<head>", StringComparison.OrdinalIgnoreCase) < 0)
            {
                throw new InvalidOperationException("index.html 里没有 <head>，无法注入 CSP。");
            }

            // meta CSP 只约束它之后发起的请求，必须早于 Vite 生成的 <link>/<script>
            // （与 VS Code 版同一个讲究，见 src/vscode/webviewPanel.ts）
            var injected = html.Replace(
                "<head>",
                "<head>\n    <meta http-equiv=\"Content-Security-Policy\" content=\"" + Csp + "\">");

            var derived = Path.Combine(directory, "index.host.html");
            if (!File.Exists(derived) || File.ReadAllText(derived, Encoding.UTF8) != injected)
            {
                File.WriteAllText(derived, injected, new UTF8Encoding(false));
            }

            core.Navigate($"https://{VirtualHost}/{_app}/index.host.html");
        }

        /// <summary>本应用该用的 CSP，只有 ssh 多放开内联样式（xterm.js 要插 &lt;style&gt;）。</summary>
        private string Csp
        {
            get
            {
                return Array.IndexOf(InlineStyleApps, _app) >= 0
                    ? CspBase + " 'unsafe-inline'"
                    : CspBase;
            }
        }

        /// <summary>初始化失败时把面板换成一句能看懂的说明，而不是留一片空白。</summary>
        private void ShowFailure(string message, string hint)
        {
            var text = "Raccoon 面板打不开：" + message;
            if (!string.IsNullOrEmpty(hint))
            {
                text += "\n\n" + hint;
            }

            Content = new TextBlock
            {
                Text = text,
                Margin = new System.Windows.Thickness(16),
                TextWrapping = System.Windows.TextWrapping.Wrap
            };
        }

        public void Reload()
        {
            if (_ready)
            {
                _webView.CoreWebView2?.Reload();
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Envelope envelope;
            try
            {
                // 恒用 PostWebMessageAsJson 的对称面：拿到的是 JSON 文本
                envelope = JsonConvert.DeserializeObject<Envelope>(e.WebMessageAsJson);
            }
            catch (JsonException)
            {
                // 前端发来的东西解析不了就丢掉，不能让一条坏消息带崩 VS
                return;
            }

            if (envelope?.Command == null)
            {
                return;
            }

            MessageReceived?.Invoke(this, envelope);
        }

        /// <summary>
        /// 前端产物所在目录：扩展安装目录下的 dist/webviews/&lt;app&gt;。
        /// 扩展根目录就是程序集所在目录（vsix 解包后 Content 与 dll 同级）。
        /// </summary>
        private string ResolveAppDirectory()
        {
            var directory = Path.Combine(ResolveWebviewsDirectory(), _app);

            if (!Directory.Exists(directory))
            {
                throw new DirectoryNotFoundException(
                    $"找不到 webview 产物：{directory}。请在项目根目录先跑 npm run build:webviews。");
            }

            return directory;
        }

        /// <summary>
        /// 四个应用共享的前端根目录：dist/webviews。
        /// 虚拟主机映射指到这里（理由见 OnLoaded 里 SetVirtualHostNameToFolderMapping 的注释）。
        /// </summary>
        private string ResolveWebviewsDirectory()
        {
            var assemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
                                    ?? AppDomain.CurrentDomain.BaseDirectory;
            var directory = Path.Combine(assemblyDirectory, "dist", "webviews");

            if (!Directory.Exists(directory))
            {
                throw new DirectoryNotFoundException(
                    $"找不到 webview 产物：{directory}。请在项目根目录先跑 npm run build:webviews。");
            }

            // 虚拟主机映射要求绝对路径（相对路径会按 devenv.exe 的位置解析）
            return Path.GetFullPath(directory);
        }
    }
}
