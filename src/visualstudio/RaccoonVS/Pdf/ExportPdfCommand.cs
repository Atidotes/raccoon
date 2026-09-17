using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Markdig;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.VisualStudio.Shell;

namespace RaccoonVS.Pdf
{
    /// <summary>
    /// Markdown → PDF。
    ///
    /// 与 VS Code 版（src/markdown/markdownToPdf.ts）的区别：那边要外挂 Chrome，
    /// 得探测安装路径、还得防着和已经在跑的浏览器抢 user-data-dir。VS 这边直接
    /// 用 WebView2 自带的 PrintToPdfAsync——VS 2022 保证有 WebView2 Runtime，
    /// 少一个外部依赖，也少一整类环境问题。
    /// </summary>
    internal static class ExportPdfCommand
    {
        /// <summary>渲染用样式，与 VS Code 版共用同一份排版（GitHub 风格 A4）。</summary>
        private const string Css = @"
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body {
  font-family: ""Microsoft YaHei"", ""PingFang SC"", ""Noto Sans CJK SC"", sans-serif;
  font-size: 10pt; line-height: 1.6; color: #1f2328; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 20pt; margin: 0 0 .8em; padding-bottom: .3em; border-bottom: 2px solid #d0d7de; }
h2 { font-size: 14pt; margin: 1.5em 0 .6em; padding-bottom: .25em; border-bottom: 1px solid #eaecef; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 1.2em 0 .4em; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 1em 0 .3em; page-break-after: avoid; }
p { margin: .5em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9pt; }
th, td { border: 1px solid #d0d7de; padding: 4px 7px; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
tr { page-break-inside: avoid; }
code { font-family: Consolas, ""Courier New"", monospace; font-size: 8.5pt; background: #f2f4f7; padding: 1px 4px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #eaecef; border-radius: 6px; padding: 10px 12px; overflow-x: auto; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }
blockquote { border-left: 4px solid #d0d7de; margin: .8em 0; padding: .1em 1em; color: #57606a; background: #f6f8fa; }
blockquote p { margin: .4em 0; }
a { color: #0969da; text-decoration: none; }
hr { border: none; border-top: 1px solid #eaecef; margin: 1.5em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .15em 0; }
img { max-width: 100%; }
";

        public static void Run()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            var target = ResolveTarget();
            if (target == null)
            {
                VsShell.Status("请先打开一个 Markdown 文件，再执行「导出为 PDF」。");
                return;
            }

            var outputPath = Path.ChangeExtension(target, ".pdf");
            VsShell.Status("正在导出 " + Path.GetFileName(outputPath) + " …");

            // 打印要建一个离屏 WebView2，必须在 UI 线程上做；渲染本身是异步的，
            // 用 RunAsync 让它自己跑完，别把命令处理器堵在这里
            RaccoonVSPackage.Instance.JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await RenderAsync(target, outputPath);
                    VsShell.Status("已导出：" + outputPath);
                }
                catch (Exception error)
                {
                    VsShell.Error("导出 PDF 失败：" + error.Message);
                }
            }).FileAndForget("raccoon/export-pdf");
        }

        /// <summary>取当前打开的 Markdown 文件（活动文档的本地路径）。</summary>
        private static string ResolveTarget()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var dte = Microsoft.VisualStudio.Shell.Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
                var document = dte?.ActiveDocument;
                var fullName = document?.FullName;
                if (!string.IsNullOrEmpty(fullName) && fullName.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
                {
                    return File.Exists(fullName) ? fullName : null;
                }
            }
            catch (Exception)
            {
                // 没有活动文档（比如焦点在工具窗口上）时走下面的提示
            }
            return null;
        }

        private static async Task RenderAsync(string markdownPath, string outputPath)
        {
            var markdown = File.ReadAllText(markdownPath, Encoding.UTF8);

            // 与 VS Code 版同样的处理：相对链接改写成 file:// 绝对地址，PDF 里点击能直接开本地文件
            var baseDirectory = Path.GetDirectoryName(markdownPath) ?? string.Empty;
            markdown = LinkRewriter.Rewrite(markdown, baseDirectory);

            var pipeline = new MarkdownPipelineBuilder().UseAdvancedExtensions().Build();
            var body = Markdown.ToHtml(markdown, pipeline);
            var title = Escape(Path.GetFileNameWithoutExtension(markdownPath));

            var html = "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                       + "<title>" + title + "</title><style>" + Css + "</style></head><body>"
                       + body + "</body></html>";

            var webView = new WebView2 { Visibility = Visibility.Hidden };
            // 离屏控件也要挂在视觉树上才能完成初始化，用一个不可见的窗口当宿主
            var window = new Window
            {
                Width = 1024,
                Height = 768,
                ShowInTaskbar = false,
                WindowStyle = WindowStyle.None,
                AllowsTransparency = true,
                Opacity = 0,
                Content = webView,
                // 别让这个窗口抢焦点打断用户
                ShowActivated = false
            };

            try
            {
                window.Show();
                await webView.EnsureCoreWebView2Async();

                var core = webView.CoreWebView2;

                // 等内容装载完再打印：NavigateToString 是异步的
                var loaded = new TaskCompletionSource<bool>();
                void OnCompleted(object sender, CoreWebView2NavigationCompletedEventArgs args)
                {
                    loaded.TrySetResult(args.IsSuccess);
                }
                core.NavigationCompleted += OnCompleted;

                try
                {
                    core.NavigateToString(html);

                    // 给渲染留一点余量，别刚解析完 DOM 就开打印
                    await Task.WhenAny(loaded.Task, Task.Delay(TimeSpan.FromSeconds(15)));
                    await Task.Delay(400);

                    var settings = core.Environment.CreatePrintSettings();
                    settings.ShouldPrintHeaderAndFooter = false;
                    // 边距单位是英寸（默认 0.4），别按毫米填
                    settings.MarginTop = 0.63;
                    settings.MarginBottom = 0.71;
                    settings.MarginLeft = 0.59;
                    settings.MarginRight = 0.59;

                    Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? ".");

                    var printed = await core.PrintToPdfAsync(outputPath, settings);
                    if (!printed)
                    {
                        throw new InvalidOperationException("打印任务没有完成。");
                    }
                }
                finally
                {
                    core.NavigationCompleted -= OnCompleted;
                }
            }
            finally
            {
                window.Close();
            }
        }

        private static string Escape(string text)
        {
            return (text ?? string.Empty)
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;");
        }
    }
}
