using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace RaccoonVS.DeepSeek
{
    /// <summary>
    /// 「配置 DeepSeek API Key」：弹一个带掩码的输入框，确认后加密保存。
    /// key 存 secrets.dat（DPAPI，CurrentUser），不落明文——settings.json 里曾经手填的
    /// apiKey 字段保留为兼容回退，但新的保存一律走这里。
    /// </summary>
    internal static class ApiKeySettings
    {
        private const string SecretKey = "deepseek.apiKey";

        /// <summary>弹框填 key；确认后加密保存并返回 true，取消返回 false。UI 线程调用。</summary>
        public static bool ConfigureAndSave()
        {
            // WPF 窗口的 ShowDialog 本来就要 STA/UI 线程，这里显式断言
            ThreadHelper.ThrowIfNotOnUIThread();

            var dialog = new ApiKeyDialog();
            TrySetOwner(dialog);

            if (dialog.ShowDialog() != true)
            {
                return false;
            }

            new SecretStore().Set(SecretKey, dialog.ApiKey);
            return true;
        }

        /// <summary>把 VS 主窗口设成 owner，避免输入框落到主窗口后面。</summary>
        private static void TrySetOwner(Window window)
        {
            // IVsUIShell 是 UI 线程专属服务；不满足时直接抛，这是调用方的 bug，不吞
            ThreadHelper.ThrowIfNotOnUIThread();

            try
            {
                var shell = ServiceProvider.GlobalProvider.GetService(typeof(SVsUIShell)) as IVsUIShell;
                if (shell != null && shell.GetDialogOwnerHwnd(out var owner) == 0 && owner != IntPtr.Zero)
                {
                    new WindowInteropHelper(window).Owner = owner;
                }
            }
            catch (Exception)
            {
                // owner 拿不到就用居中模式，不挡配置流程
            }
        }

        private sealed class ApiKeyDialog : Window
        {
            private readonly PasswordBox _box;

            /// <summary>填进去的 key（已去首尾空白），取消则为 null。</summary>
            public string ApiKey { get; private set; }

            public ApiKeyDialog()
            {
                Title = "配置 DeepSeek API Key";
                Width = 440;
                SizeToContent = SizeToContent.Height;
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
                ResizeMode = ResizeMode.NoResize;
                ShowInTaskbar = false;

                var grid = new Grid { Margin = new Thickness(12) };
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

                var hint = new TextBlock
                {
                    Text = "输入 DeepSeek 的 API Key（sk- 开头）。\n它会被加密保存（DPAPI），不会明文落盘。",
                    TextWrapping = TextWrapping.Wrap
                };
                Grid.SetRow(hint, 0);
                grid.Children.Add(hint);

                _box = new PasswordBox { Margin = new Thickness(0, 10, 0, 0) };
                Grid.SetRow(_box, 1);
                grid.Children.Add(_box);

                var buttons = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Right,
                    Margin = new Thickness(0, 12, 0, 0)
                };
                var ok = new Button { Content = "确定", Width = 80, Margin = new Thickness(0, 0, 8, 0), IsDefault = true };
                ok.Click += OnOk;
                var cancel = new Button { Content = "取消", Width = 80, IsCancel = true };
                buttons.Children.Add(ok);
                buttons.Children.Add(cancel);
                Grid.SetRow(buttons, 2);
                grid.Children.Add(buttons);

                Content = grid;
                Loaded += (sender, args) => _box.Focus();
            }

            private void OnOk(object sender, RoutedEventArgs e)
            {
                ApiKey = _box.Password.Trim();
                DialogResult = true;
            }
        }
    }
}
