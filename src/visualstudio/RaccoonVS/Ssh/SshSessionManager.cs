using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace RaccoonVS.Ssh
{
    /// <summary>
    /// SSH 会话池，行为对齐 src/ssh/sessionManager.ts。
    /// 一个会话 = 一个 SshClient + 一条 shell 通道，由 webview 里的一个终端标签对应。
    ///
    /// 这里只管连接和字节搬运，不碰 UI；状态变化通过回调出去，由面板转成消息。
    /// </summary>
    internal sealed class SshSessionManager : IDisposable
    {
        private const int ReadyTimeoutSeconds = 20;
        /// <summary>测试连接就该快，不给 20 秒慢慢等。</summary>
        private const int TestTimeoutSeconds = 10;

        private static readonly TimeSpan KeepAlive = TimeSpan.FromSeconds(30);
        private const string TerminalType = "xterm-256color";
        private const int BufferSize = 8192;

        private readonly ServerStore _store;
        private readonly KnownHosts _knownHosts;
        private readonly Action<string, string, string> _onStatus;
        private readonly Action<string, string> _onData;
        private readonly object _gate = new object();
        private readonly Dictionary<string, Session> _sessions = new Dictionary<string, Session>();

        private sealed class Session
        {
            public string ServerId;
            public SshClient Client;
            public ShellStream Shell;
            /// <summary>已上报过结束了，避免多个事件重复通知。</summary>
            public bool Finished;
            /// <summary>终端输出的解码器。跨块的多字节字符必须状态化解码（见 Pump）。</summary>
            public Decoder Decoder;
            /// <summary>最近一次已知尺寸，pty 申请时可能已过时，attach 后会用它补发一次。</summary>
            public uint Cols;
            public uint Rows;
            /// <summary>ShellStream 的读写都在这个线程上串行，Stream 不是线程安全的。</summary>
            public readonly object Io = new object();
        }

        public SshSessionManager(
            ServerStore store,
            KnownHosts knownHosts,
            Action<string, string, string> onStatus,
            Action<string, string> onData)
        {
            _store = store;
            _knownHosts = knownHosts;
            _onStatus = onStatus;
            _onData = onData;
        }

        public void Open(string sessionId, ServerRecord server, int cols, int rows)
        {
            // 同一个标签重复点连接，忽略后一次
            lock (_gate)
            {
                if (_sessions.ContainsKey(sessionId))
                {
                    return;
                }
                _sessions[sessionId] = new Session
                {
                    ServerId = server.Id,
                    Cols = (uint)Math.Max(cols, 1),
                    Rows = (uint)Math.Max(rows, 1),
                    Decoder = Encoding.UTF8.GetDecoder()
                };
            }

            _onStatus(sessionId, "connecting", null);

            // 连接是阻塞的（SSH.NET 的同步 API），放到线程池上跑，别卡住 VS 的 UI 线程。
            // 凭据要先从 DPAPI 里取出来，这一步也是文件 IO，一并放进去。
            // 故意不 await：Open 是同步入口，连接结果通过 _onStatus 回调出去
            _ = Task.Run(() => Connect(sessionId, server));
        }

        private void Connect(string sessionId, ServerRecord server)
        {
            var session = Get(sessionId);
            if (session == null)
            {
                return;
            }

            SshClient client = null;
            var problem = new HostKeyProblem();

            try
            {
                client = BuildClient(server, null, null, problem);
                session.Client = client;
                client.Connect();
            }
            catch (Exception error)
            {
                Finish(sessionId, "error", problem.Message ?? DescribeConnectError(error, server));
                Cleanup(client);
                return;
            }

            // 连接建立后要先确认会话还在（用户可能在握手期间就点了关闭）
            if (Get(sessionId) == null)
            {
                Cleanup(client);
                return;
            }

            try
            {
                var shell = client.CreateShellStream(
                    TerminalType, session.Cols, session.Rows, 0, 0, BufferSize);

                // 申请 pty 时带的尺寸可能已经过时（握手期间用户拖过窗口），补一次
                shell.ChangeWindowSize(session.Cols, session.Rows, 0, 0);
                session.Shell = shell;

                // 读循环放在独立线程上：ShellStream.Read 会阻塞到有数据为止
                var reader = new Thread(() => Pump(sessionId, session)) { IsBackground = true };
                reader.Start();
            }
            catch (Exception error)
            {
                Finish(sessionId, "error", DescribeConnectError(error, server));
                Cleanup(client);
                return;
            }

            _onStatus(sessionId, "connected", null);
        }

        /// <summary>
        /// 终端输出的搬运循环。
        ///
        /// 必须用状态化的 Decoder：一个中文字符占 3 字节，正好跨在两次 TCP 分包边界上时，
        /// 各自独立解码会解出两个替换符（U+FFFD）。
        /// </summary>
        private void Pump(string sessionId, Session session)
        {
            var buffer = new byte[BufferSize];
            var chars = new char[BufferSize + 1];

            try
            {
                while (true)
                {
                    int read;
                    lock (session.Io)
                    {
                        if (session.Shell == null || !session.Shell.CanRead)
                        {
                            break;
                        }
                        read = session.Shell.Read(buffer, 0, buffer.Length);
                    }

                    if (read <= 0)
                    {
                        break;
                    }

                    // Decoder 只被这个线程碰，不用额外加锁
                    var produced = session.Decoder.GetChars(buffer, 0, read, chars, 0);
                    if (produced > 0)
                    {
                        _onData(sessionId, new string(chars, 0, produced));
                    }
                }
            }
            catch (Exception)
            {
                // 连接被远端掐断时 Read 会抛，跟读到 0 是一回事
            }

            // 链路自己断了（网络切换、服务端踢人）也走收摊流程
            Cleanup(session.Client);
            Finish(sessionId, "closed", null);
        }

        public void Input(string sessionId, string data)
        {
            var session = Get(sessionId);
            if (session?.Shell == null || data == null)
            {
                return;
            }

            try
            {
                lock (session.Io)
                {
                    session.Shell.Write(data);
                    session.Shell.Flush();
                }
            }
            catch (Exception)
            {
                // 连接已断，输入丢弃即可
            }
        }

        public void Resize(string sessionId, int cols, int rows)
        {
            var session = Get(sessionId);
            if (session == null)
            {
                return;
            }

            session.Cols = (uint)Math.Max(cols, 1);
            session.Rows = (uint)Math.Max(rows, 1);

            var shell = session.Shell;
            if (shell == null)
            {
                // 通道还没开就先把尺寸记下来，attach 时会补发
                return;
            }

            try
            {
                lock (session.Io)
                {
                    shell.ChangeWindowSize(session.Cols, session.Rows, 0, 0);
                }
            }
            catch (Exception)
            {
                // 连接正在关闭时改窗口大小会抛，忽略
            }
        }

        public void Close(string sessionId)
        {
            var session = Get(sessionId);
            if (session != null)
            {
                Cleanup(session.Client);
            }
            Finish(sessionId, "closed", null);
        }

        /// <summary>关掉某台服务器的所有会话。删除服务器记录时用，不留连着一个已删记录的会话。</summary>
        public void CloseByServer(string serverId)
        {
            List<string> targets = new List<string>();
            lock (_gate)
            {
                foreach (var pair in _sessions)
                {
                    if (pair.Value.ServerId == serverId)
                    {
                        targets.Add(pair.Key);
                    }
                }
            }

            foreach (var sessionId in targets)
            {
                var session = Get(sessionId);
                if (session != null)
                {
                    Cleanup(session.Client);
                }
                Finish(sessionId, "closed", null);
            }
        }

        /// <summary>
        /// 测试连接：只验证握手 + 认证能过，不开 shell 不占标签。
        ///
        /// draft 是表单当前内容（包括还没保存的密码），用完即丢，不落任何存储。
        /// 主机密钥照常走 TOFU——测试连接也是一次真实握手，该记的记、该拦的拦。
        /// </summary>
        public Task<JObject> TestAsync(ServerDraft draft)
        {
            return Task.Run(() =>
            {
                var record = SshValidate.ToRecord(draft, string.Empty);
                var problem = new HostKeyProblem();
                SshClient client = null;

                try
                {
                    client = BuildClient(record, draft.Password, draft.Passphrase, problem, TestTimeoutSeconds);
                    client.Connect();
                    return Result(true, null);
                }
                catch (Exception error)
                {
                    return Result(false, problem.Message ?? DescribeConnectError(error, record));
                }
                finally
                {
                    Cleanup(client);
                }
            });
        }

        private static JObject Result(bool ok, string detail)
        {
            var result = new JObject { ["ok"] = ok };
            if (!string.IsNullOrEmpty(detail))
            {
                result["detail"] = detail;
            }
            return result;
        }

        /// <summary>
        /// 组装一个还没连接的客户端，含 TOFU 主机密钥校验。
        ///
        /// 凭据来源：override 非空时用表单临时值（测试连接），否则从 DPAPI 存储取。
        /// 主机密钥不一致时的说明文案写进 problem：事件在 SSH.NET 的工作线程上触发，
        /// 返回值送不出来，只能借这个对象把结论带回调用方。
        /// </summary>
        private SshClient BuildClient(
            ServerRecord server,
            string passwordOverride,
            string passphraseOverride,
            HostKeyProblem problem,
            int timeoutSeconds = ReadyTimeoutSeconds)
        {
            var info = new ConnectionInfo(
                server.Host, server.Port, server.Username, BuildAuth(server, passwordOverride, passphraseOverride).ToArray())
            {
                Timeout = TimeSpan.FromSeconds(timeoutSeconds)
            };

            var client = new SshClient(info);
            client.KeepAliveInterval = KeepAlive;

            // 主机密钥事件挂在 client 上（不是 ConnectionInfo）。
            //
            // 关键：CanTrust 的默认值是 true——不赋值等于零校验。这里先置 false，
            // 只有确认「首次见」或「与记录的指纹一致」才放开。
            client.HostKeyReceived += (sender, e) =>
            {
                e.CanTrust = false;
                if (_knownHosts.Check(server.Host, server.Port, e.HostKey) == HostKeyVerdict.Mismatch)
                {
                    problem.Message = KnownHosts.MismatchMessage(
                        server.Host, server.Port, timeoutSeconds == TestTimeoutSeconds);
                    return;
                }
                e.CanTrust = true;
            };

            return client;
        }

        /// <summary>主机密钥校验的结论，由事件处理器写、调用方读。</summary>
        private sealed class HostKeyProblem
        {
            public string Message;
        }

        /// <summary>按记录的认证方式组装凭据。</summary>
        private List<AuthenticationMethod> BuildAuth(
            ServerRecord server, string passwordOverride, string passphraseOverride)
        {
            var methods = new List<AuthenticationMethod>();

            switch (SshValidate.ParseAuthMethod(server.AuthMethod))
            {
                case "privateKey":
                {
                    var keyPath = server.PrivateKeyPath;
                    if (string.IsNullOrEmpty(keyPath))
                    {
                        throw new InvalidOperationException("这台服务器没配私钥文件路径，请在编辑表单里补上。");
                    }

                    var passphrase = !string.IsNullOrEmpty(passphraseOverride)
                        ? passphraseOverride
                        : _store.Passphrase(server.Id);

                    PrivateKeyFile key;
                    try
                    {
                        key = string.IsNullOrEmpty(passphrase)
                            ? new PrivateKeyFile(keyPath)
                            : new PrivateKeyFile(keyPath, passphrase);
                    }
                    catch (Exception error)
                    {
                        // SshNet 对「文件不存在」和「passphrase 不对」抛的是不同类型的异常，
                        // 这里统一翻成中文
                        throw new InvalidOperationException(
                            DescribeKeyError(error, keyPath), error);
                    }

                    methods.Add(new PrivateKeyAuthenticationMethod(server.Username, key));
                    break;
                }

                case "agent":
                {
                    // SSH.NET 官方不支持 ssh-agent（既没有 OpenSSH agent 也没有 Pageant），
                    // 第三方 SshNet.Agent 有已知 bug（ED25519 密钥损坏、agent 未启动时死锁），
                    // 不引这个依赖。给一句能操作的提示，密码和私钥文件都不受影响。
                    throw new InvalidOperationException(
                        "Visual Studio 版暂不支持 ssh-agent 认证，请改用「密码」或「私钥文件」。");
                }

                default:
                {
                    var password = !string.IsNullOrEmpty(passwordOverride)
                        ? passwordOverride
                        : _store.Password(server.Id);

                    if (password == null)
                    {
                        throw new InvalidOperationException("这台服务器还没有存过密码，请在编辑表单里填一次。");
                    }

                    methods.Add(new PasswordAuthenticationMethod(server.Username, password));
                    break;
                }
            }

            return methods;
        }

        private static string DescribeKeyError(Exception error, string keyPath)
        {
            var message = error.Message ?? string.Empty;
            if (error is FileNotFoundException || error is DirectoryNotFoundException)
            {
                return "读不到私钥文件：" + keyPath;
            }
            if (error is SshPassPhraseNullOrEmptyException
                || message.IndexOf("passphrase", StringComparison.OrdinalIgnoreCase) >= 0
                || message.IndexOf("Invalid passport", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "私钥读不了：文件格式不对，或者 passphrase 错了。";
            }
            return "私钥读不了：" + message;
        }

        /// <summary>把 SshNet 抛出的英文错误翻成能看懂的一句中文（对齐 describeConnectError）。</summary>
        public static string DescribeConnectError(Exception error, ServerRecord server)
        {
            var raw = Flatten(error);
            var target = server.Username + "@" + server.Host + ":" + server.Port;

            if (raw.IndexOf("ECONNREFUSED", StringComparison.OrdinalIgnoreCase) >= 0
                || HasInner<SocketException>(error, SocketError.ConnectionRefused))
            {
                return "连接 " + target + " 被拒绝：对方端口没在监听，或者被防火墙挡了。";
            }
            if (raw.IndexOf("ENOTFOUND", StringComparison.OrdinalIgnoreCase) >= 0
                || raw.IndexOf("EAI_AGAIN", StringComparison.OrdinalIgnoreCase) >= 0
                || HasInner<SocketException>(error, SocketError.HostNotFound))
            {
                return "找不到主机 " + server.Host + "：域名解析失败，检查一下地址拼写或 DNS。";
            }
            if (error is SshOperationTimeoutException
                || HasInner<SocketException>(error, SocketError.TimedOut)
                || raw.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "连接 " + target + " 超时：网络不通，或者对方没有响应。";
            }
            if (error is SshAuthenticationException
                || raw.IndexOf("Permission denied", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "登录 " + target + " 失败：用户名、密码或密钥不对。";
            }
            if (error is SshConnectionException
                && raw.IndexOf("key exchange", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "和 " + target + " 协商加密算法失败：对方可能只支持过时的算法。";
            }

            return raw + "（" + target + "）";
        }

        private static bool HasInner<T>(Exception error, SocketError code) where T : SocketException
        {
            for (var current = error; current != null; current = current.InnerException)
            {
                var socket = current as SocketException;
                if (socket != null && socket.SocketErrorCode == code)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>把异常链上的消息拼起来，内层的 SocketException 往往才是有信息量的那句。</summary>
        private static string Flatten(Exception error)
        {
            var parts = new List<string>();
            for (var current = error; current != null; current = current.InnerException)
            {
                if (!string.IsNullOrEmpty(current.Message) && !parts.Contains(current.Message))
                {
                    parts.Add(current.Message);
                }
            }
            return string.Join(" ", parts);
        }

        private Session Get(string sessionId)
        {
            lock (_gate)
            {
                return _sessions.TryGetValue(sessionId, out var session) ? session : null;
            }
        }

        /// <summary>收摊：先标记再删，重复调用无副作用。</summary>
        private void Finish(string sessionId, string status, string detail)
        {
            lock (_gate)
            {
                if (!_sessions.TryGetValue(sessionId, out var session) || session.Finished)
                {
                    return;
                }
                session.Finished = true;
                _sessions.Remove(sessionId);
            }
            _onStatus(sessionId, status, detail);
        }

        private static void Cleanup(SshClient client)
        {
            if (client == null)
            {
                return;
            }
            try
            {
                if (client.IsConnected)
                {
                    client.Disconnect();
                }
                client.Dispose();
            }
            catch (Exception)
            {
                // 本来就是在收摊，收不干净也没什么可做的
            }
        }

        public void Dispose()
        {
            List<Session> all;
            lock (_gate)
            {
                all = new List<Session>(_sessions.Values);
                foreach (var session in all)
                {
                    session.Finished = true;
                }
                _sessions.Clear();
            }

            foreach (var session in all)
            {
                Cleanup(session.Client);
            }
        }
    }
}
