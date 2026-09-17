using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using RaccoonVS.Ssh;
using Task = System.Threading.Tasks.Task;

namespace RaccoonVS
{
    /// <summary>命令 id，与 Commands.vsct 里的 IDSymbol 逐条对应。</summary>
    internal static class CommandIds
    {
        public static readonly Guid CommandSet = new Guid("2C1A7D5E-9B3F-4E2A-8C6D-1F0B3A5C7E90");

        public const int Tetris = 0x0100;
        public const int Gomoku = 0x0200;
        public const int Snake = 0x0300;
        public const int Ssh = 0x0400;
        public const int ExportPdf = 0x0500;
        public const int RefreshBalance = 0x0600;
        public const int ConfigureApiKey = 0x0700;
    }

    /// <summary>
    /// 扩展入口：注册工具窗口与命令，拉起状态栏余额显示。
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("Raccoon", "游戏 / 办公 / 小工具集合", "1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(Games.TetrisToolWindow), Style = VsDockStyle.Tabbed, Window = ToolWindowGuids.SolutionExplorer, Width = 640, Height = 780)]
    [ProvideToolWindow(typeof(Games.GomokuToolWindow), Style = VsDockStyle.Tabbed, Window = ToolWindowGuids.SolutionExplorer, Width = 720, Height = 720)]
    [ProvideToolWindow(typeof(Games.SnakeToolWindow), Style = VsDockStyle.Tabbed, Window = ToolWindowGuids.SolutionExplorer, Width = 640, Height = 780)]
    [ProvideToolWindow(typeof(SshToolWindow), Style = VsDockStyle.Tabbed, Window = ToolWindowGuids.SolutionExplorer, Width = 900, Height = 600)]
    [Guid(PackageGuidString)]
    public sealed class RaccoonVSPackage : AsyncPackage
    {
        public const string PackageGuidString = "9C4B1B3E-7E1A-4A6E-9E5B-2F1B4A6C7D80";

        /// <summary>当前实例。工具窗口和对话框拿它当 IServiceProvider。</summary>
        public static RaccoonVSPackage Instance { get; private set; }

        private DeepSeek.BalanceService _balance;

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            Instance = this;

            // 包默认在后台线程初始化，碰 VS 服务之前必须切到 UI 线程
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            VsShell.VsStatusbar = await GetServiceAsync(typeof(SVsStatusbar)) as IVsStatusbar;

            await InitializeCommandsAsync(cancellationToken);

            _balance = new DeepSeek.BalanceService();
            _balance.Start();
        }

        private async Task InitializeCommandsAsync(CancellationToken cancellationToken)
        {
            var commandService = await GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
            if (commandService == null)
            {
                return;
            }

            Bind(commandService, CommandIds.Tetris, (s, e) => ShowToolWindow(typeof(Games.TetrisToolWindow)));
            Bind(commandService, CommandIds.Gomoku, (s, e) => ShowToolWindow(typeof(Games.GomokuToolWindow)));
            Bind(commandService, CommandIds.Snake, (s, e) => ShowToolWindow(typeof(Games.SnakeToolWindow)));
            Bind(commandService, CommandIds.Ssh, (s, e) => ShowToolWindow(typeof(SshToolWindow)));
            Bind(commandService, CommandIds.ExportPdf, (s, e) =>
            {
                // 导出要读 DTE 的活动文档，这是 UI 线程专属的服务
                ThreadHelper.ThrowIfNotOnUIThread();
                Pdf.ExportPdfCommand.Run();
            });
            Bind(commandService, CommandIds.ConfigureApiKey, (s, e) =>
            {
                // 输入框是 WPF 窗口，必须在 UI 线程上弹
                ThreadHelper.ThrowIfNotOnUIThread();
                if (DeepSeek.ApiKeySettings.ConfigureAndSave())
                {
                    // 存好了立即查一次，让状态栏马上反映新 key 的结果
                    _balance?.Refresh();
                }
            });
            Bind(commandService, CommandIds.RefreshBalance, (s, e) => _balance?.Refresh());
        }

        private static void Bind(OleMenuCommandService service, int id, EventHandler handler)
        {
            service.AddCommand(new MenuCommand(handler, new CommandID(CommandIds.CommandSet, id)));
        }

        /// <summary>
        /// 显示（没有就创建）工具窗口。已经开着时只是把它显示出来，不会开出第二个。
        ///
        /// 这里不 await：ShowToolWindowAsync 内部会做 JTF 切换，从命令处理器里同步等
        /// 它有死锁风险，交给 JoinableTaskFactory 自己跑完。
        /// </summary>
        private void ShowToolWindow(Type windowType)
        {
            JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    // 命令回调和包初始化都在 UI 线程上，但 RunAsync 之后不保证还留在那里
                    await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);

                    var window = await ShowToolWindowAsync(windowType, 0, true, DisposalToken) as ToolWindowPane;

                    // ToolWindowPane.Frame 在 Shell.15.0 里声明的类型是 object（不是 IVsWindowFrame），
                    // 想调 Show() 必须自己转一次。
                    var frame = window?.Frame as IVsWindowFrame;
                    frame?.Show();
                }
                catch (Exception error)
                {
                    VsShell.Error("Raccoon：打开面板失败 —— " + error.Message);
                }
            }).FileAndForget("raccoon/show-tool-window");
        }

        /// <summary>包在 UI 线程上跑一段代码（主题变化等事件回调里用）。</summary>
        public void RunOnUIThread(Action action)
        {
            JoinableTaskFactory.RunAsync(async () =>
            {
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    action();
                }
                catch (Exception)
                {
                    // 面板刷新失败不是致命问题，下次打开就是新的
                }
            }).FileAndForget("raccoon/ui-thread-action");
        }

        /// <summary>
        /// VS 换配色时重新下发主题。
        ///
        /// 没有走 IVsUIShell 的广播消息：那套 API 要自己实现 IVsBroadcastMessageEvents
        /// 再拿 shell 的 cookie，接口在 17.x 里还挪过位置，为一个「锦上添花」的刷新
        /// 去赌它不划算。实现在这里换掉：面板每次打开都会重新下发主题，
        /// 用户换完主题重开一次面板即可，不会出现配色错乱。
        /// </summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _balance?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
