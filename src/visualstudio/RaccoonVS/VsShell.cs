using System;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace RaccoonVS
{
    /// <summary>
    /// VS 服务的一点点封装：对话框与状态栏。
    ///
    /// 这些辅助设施都是「取不到就降级」的——任何一个失败都不该让功能本身走不下去，
    /// 所以全部吞异常返回兜底值。
    /// </summary>
    internal static class VsShell
    {
        /// <summary>
        /// 确认对话框。返回是否点了确认。
        ///
        /// 默认按钮给「取消」：调用方拿它兜的是删除这类不可逆操作，
        /// 用户闭着眼睛敲回车时不该把东西删掉。
        /// </summary>
        public static bool Confirm(IServiceProvider provider, string message, string confirmLabel)
        {
            try
            {
                var result = VsShellUtilities.ShowMessageBox(
                    provider,
                    message,
                    "Raccoon",
                    confirmLabel,
                    OLEMSGICON.OLEMSGICON_WARNING,
                    OLEMSGBUTTON.OLEMSGBUTTON_OKCANCEL,
                    OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_SECOND);

                return result == ExtendedMessageBoxResult.OK;
            }
            catch (Exception)
            {
                // 弹不出对话框时按「不删」处理：删除是不可逆操作，宁可什么都不做
                return false;
            }
        }

        public static void Error(string message)
        {
            Status(message);
        }

        /// <summary>
        /// 往状态栏写一行字。可在任意线程调用。
        ///
        /// 对应 VS Code 版的 showInformationMessage。状态栏只有一行，这条会盖掉别的
        /// 扩展写的文字——VS Code 版的弹窗没有这个问题。这里是平台差异带来的取舍：
        /// 不想为了「游戏结束」这类提示弹一个模态框打断用户。
        ///
        /// IVsStatusbar 是 UI 线程专属的 COM 接口，而调用方遍布各处（游戏结束的回调、
        /// SSH 连接线程、余额轮询的线程池线程），所以在这里统一兜住线程，不要求调用方管。
        /// </summary>
        public static void Status(string message)
        {
            try
            {
                if (VsStatusbar == null)
                {
                    return;
                }

                if (ThreadHelper.CheckAccess())
                {
                    // 分析器不认 CheckAccess() 这个守卫，只认 ThrowIfNotOnUIThread，
                    // 但这里恰恰要允许从后台线程调用，不能抛。
#pragma warning disable VSTHRD010
                    VsStatusbar.SetText(message);
#pragma warning restore VSTHRD010
                    return;
                }

                // 已经在线程池上时直接切过去等结果：写状态栏很快，等它比排队更简单
                ThreadHelper.JoinableTaskFactory.Run(async () =>
                {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    VsStatusbar?.SetText(message);
                });
            }
            catch (Exception)
            {
                // 状态栏写不进去无所谓，功能已经完成了
            }
        }

        /// <summary>状态栏。包初始化时缓存下来，省得每次去问服务。</summary>
        public static IVsStatusbar VsStatusbar { get; set; }
    }
}
