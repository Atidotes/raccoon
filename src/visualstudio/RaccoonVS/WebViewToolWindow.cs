using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace RaccoonVS
{
    /// <summary>
    /// 内嵌 WebView2 的工具窗口基类：三个游戏 + SSH 面板共用。
    ///
    /// ToolWindowPane 的构造顺序有个坑——基类构造函数先跑，那时派生类的字段还是 null。
    /// 所以这里不在构造函数里碰任何虚方法，全部走 Loaded 之后再触发的回调。
    /// </summary>
    internal abstract class WebViewToolWindow : ToolWindowPane
    {
        private bool _disposed;

        protected WebViewToolWindow(RaccoonVSPackage package, WebViewPanelHost host)
            : base(null)
        {
            Host = host;
            Content = host;

            host.Ready += (sender, args) => OnWebViewReady();
            host.MessageReceived += (sender, message) => OnWebViewMessage(message);
        }

        protected WebViewPanelHost Host { get; private set; }

        /// <summary>把当前主题推给 webview。VS 换主题时由包调用。</summary>
        public void PushCurrentTheme()
        {
            PushTheme();
        }

        /// <summary>webview 加载完成、CoreWebView2 可用（还没收到任何消息）。</summary>
        protected virtual void OnWebViewReady()
        {
            // 默认什么都不做：面板要下发的东西（比如当前主题）由子类决定
        }

        /// <summary>收到 webview 的消息，已在 UI 线程上。</summary>
        protected abstract void OnWebViewMessage(Envelope message);

        /// <summary>
        /// 组装一条发给 webview 的消息。
        ///
        /// 用 JObject 手搓而不是序列化 DTO：协议里可选字段很多，且字段名与 TS 侧
        /// 逐字对应，手搓能一眼看出线格式，也不用为了几个字段多定义一层类型。
        /// </summary>
        internal static JObject Message(string command, Action<JObject> fill = null)
        {
            var message = new JObject { ["command"] = command };
            fill?.Invoke(message);
            return message;
        }

        /// <summary>
        /// VS 配色转成前端的主题名。
        ///
        /// WebView2 的 prefers-color-scheme 跟的是 Windows 系统主题，不是 VS 主题——
        /// 深色 VS 配浅色系统的用户会直接闪瞎。prefers-color-scheme 的兜底值也不可靠，
        /// 所以这里以 VS 自己的取色为准。
        /// </summary>
        protected static string CurrentTheme()
        {
            try
            {
                var color = Microsoft.VisualStudio.PlatformUI.VSColorTheme.GetThemedColor(
                    Microsoft.VisualStudio.PlatformUI.EnvironmentColors.ToolWindowBackgroundColorKey);

                // 感知亮度：0.299R + 0.587G + 0.114B，超过中间值算浅色。
                // 不用 ToString() 比字符串——那要拼出 "#FF1E1E1E" 这种格式再解析，更脆。
                var luminance = (0.299 * color.R + 0.587 * color.G + 0.114 * color.B) / 255.0;
                return luminance > 0.5 ? Protocol.ThemeLight : Protocol.ThemeDark;
            }
            catch (Exception)
            {
                // 主题服务取不到（极少见）时保持默认深色，与 VS Code 版的观感一致
                return Protocol.ThemeDark;
            }
        }

        /// <summary>把当前主题推给 webview。</summary>
        protected void PushTheme()
        {
            var theme = CurrentTheme();
            Host.Post(Message(Protocol.MsgTheme, m => m["theme"] = theme));
        }

        protected virtual void OnWebViewClosed()
        {
        }

        protected override void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                _disposed = true;
                if (disposing)
                {
                    try
                    {
                        OnWebViewClosed();
                    }
                    catch (Exception)
                    {
                        // 关闭路径上不该再抛
                    }
                }
            }
            base.Dispose(disposing);
        }
    }
}
