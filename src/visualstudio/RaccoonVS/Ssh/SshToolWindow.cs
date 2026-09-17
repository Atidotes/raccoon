using System;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace RaccoonVS.Ssh
{
    /// <summary>
    /// 「SSH 连接」工具窗口。前端仍然是那一份 dist/webviews/ssh，这里只做消息路由。
    ///
    /// 每个分支都对应 src/ssh/terminalPanel.ts 里的一个 case，行为必须保持一致：
    /// 校验以宿主为准、删除前先问一句、删记录前先断掉它的会话。
    /// </summary>
    // public + 无参构造：VS 用 Activator.CreateInstance 创建工具窗口（见 WebViewToolWindow 的注释）。
    public sealed class SshToolWindow : WebViewToolWindow
    {
        private readonly ServerStore _store = new ServerStore();
        private readonly KnownHosts _knownHosts = new KnownHosts();
        private SshSessionManager _sessions;

        public SshToolWindow()
            : base(new WebViewPanelHost("ssh"))
        {
            // 不设 BitmapResourceID：项目里没有图标条，指过去只会让 VS 找不到资源。
            // 不设时 VS 用默认的工具窗口图标，四个面板靠 Caption 区分。
            Caption = "SSH 连接";
        }

        protected override void OnWebViewReady()
        {
            // 面板销毁会重建，会话池跟着换一份新的，别把上一个面板的连接留成孤儿
            _sessions?.Dispose();
            _sessions = new SshSessionManager(
                _store,
                _knownHosts,
                onStatus: (sessionId, status, detail) =>
                    Host.Post(Message("ssh:status", m =>
                    {
                        m["sessionId"] = sessionId;
                        m["status"] = status;
                        if (!string.IsNullOrEmpty(detail))
                        {
                            m["detail"] = detail;
                        }
                    })),
                onData: (sessionId, data) =>
                    Host.Post(Message("ssh:data", m =>
                    {
                        m["sessionId"] = sessionId;
                        m["data"] = data;
                    })));

            base.OnWebViewReady();
        }

        protected override void OnWebViewMessage(Envelope message)
        {
            switch (message.Command)
            {
                case Protocol.MsgSshReady:
                    PushServers();
                    break;

                case Protocol.MsgSshSave:
                {
                    var errors = _store.Save(message.Object<ServerDraft>("draft") ?? new ServerDraft());
                    if (errors != null)
                    {
                        Host.Post(Message(Protocol.MsgSshFormError, m => m["errors"] = errors));
                        break;
                    }
                    PushServers();
                    break;
                }

                case Protocol.MsgSshDelete:
                    DeleteServer(message.String("id"));
                    break;

                case Protocol.MsgSshConnect:
                {
                    var server = _store.Get(message.String("serverId"));
                    if (server == null)
                    {
                        // 列表在别处被改过时可能出现这种竞态，给一句能看懂的话
                        var sessionId = message.String("sessionId");
                        Host.Post(Message(Protocol.MsgSshStatus, m =>
                        {
                            m["sessionId"] = sessionId;
                            m["status"] = "error";
                            m["detail"] = "找不到这台服务器，它可能已经被删掉了。";
                        }));
                        break;
                    }
                    // Open 内部自己接住所有失败并通过状态回调上报，这里不用等
                    _sessions.Open(
                        message.String("sessionId"), server,
                        message.Int("cols", 80), message.Int("rows", 24));
                    break;
                }

                case Protocol.MsgSshClose:
                    _sessions.Close(message.String("sessionId"));
                    break;

                case Protocol.MsgSshInput:
                    _sessions.Input(message.String("sessionId"), message.String("data"));
                    break;

                case Protocol.MsgSshResize:
                    _sessions.Resize(message.String("sessionId"), message.Int("cols", 80), message.Int("rows", 24));
                    break;

                case Protocol.MsgSshTest:
                {
                    var draft = message.Object<ServerDraft>("draft") ?? new ServerDraft();

                    // 表单不合法就逐字段回填，别发起一次注定要失败的连接
                    var errors = SshValidate.ValidateDraft(draft);
                    if (errors.Count > 0)
                    {
                        Host.Post(Message(Protocol.MsgSshFormError, m => m["errors"] = errors));
                        break;
                    }

                    // 试连是阻塞的，扔到线程池上等结果，回调里再回到 UI 线程发消息。
                    // TestAsync 内部已经把异常收成了 ok/detail，不会出现未观察的失败
#pragma warning disable VSTHRD110
                    _sessions.TestAsync(draft).ContinueWith(task =>
                    {
                        try
                        {
                            var result = task.Result;
                            Host.Post(Message(Protocol.MsgSshTestResult, m =>
                            {
                                m["ok"] = result.Value<bool>("ok");
                                var detail = result.Value<string>("detail");
                                if (!string.IsNullOrEmpty(detail))
                                {
                                    m["detail"] = detail;
                                }
                            }));
                        }
                        catch (Exception)
                        {
                            // 这个回调跑在线程池上，漏出去的异常会炸掉整个 VS 进程
                        }
                    }, TaskScheduler.Default);
#pragma warning restore VSTHRD110
                    break;
                }
            }
        }

        private void PushServers()
        {
            var servers = JArray.FromObject(_store.ListForWebview());
            Host.Post(Message(Protocol.MsgSshServers, m => m["servers"] = servers));
        }

        private void DeleteServer(string id)
        {
            var target = _store.Get(id);
            if (target == null)
            {
                return;
            }

            // 删记录会连 DPAPI 里的密码一起清掉，这一步不可逆，问一句
            var confirmed = VsShell.Confirm(
                RaccoonVSPackage.Instance,
                "确定删除服务器「" + target.Name + "」吗？保存的密码也会一并删除。",
                "删除");

            if (!confirmed)
            {
                return;
            }

            // 先断掉这台机器的会话再删记录。webview 收到新列表后，
            // 会把列表里已经不存在的服务器的标签收掉
            _sessions.CloseByServer(id);
            _store.Remove(id);
            PushServers();
        }

        protected override void OnWebViewClosed()
        {
            _sessions?.Dispose();
            _sessions = null;
            base.OnWebViewClosed();
        }
    }
}
