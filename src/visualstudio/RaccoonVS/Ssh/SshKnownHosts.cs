using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace RaccoonVS.Ssh
{
    internal enum HostKeyVerdict
    {
        New,
        Match,
        Mismatch
    }

    /// <summary>
    /// TOFU（Trust On First Use，首次连接即信任），对齐 src/ssh/knownHosts.ts。
    ///
    /// SSH.NET 默认**完全信任**收到的主机密钥（HostKeyEventArgs.CanTrust 初值就是 true），
    /// 也就是对中间人攻击不设防。这里补上最基本的一道：第一次连某台机器时记住它的指纹，
    /// 之后再连必须一致，不一致就断开并告警。
    ///
    /// 挡不住「第一次连的时候就已经被劫持」，但能挡住之后任何一次密钥替换。
    /// </summary>
    internal sealed class KnownHosts
    {
        private readonly JsonStore<Dictionary<string, string>> _store =
            new JsonStore<Dictionary<string, string>>("known_hosts.json");

        private readonly object _gate = new object();

        /// <summary>
        /// 主机密钥指纹，形如 SHA256:Abc123...，与 ssh-keygen -lf 的输出格式一致。
        ///
        /// 自己算而不是用 SshNet 的 FingerPrintSHA256：后者不带前缀、规则由库决定，
        /// 自己算才能保证和 VS Code 版（knownHosts.ts）产出同一串字符——
        /// 同一台机器在两个编辑器里必须是同一个指纹，能直接和运维给的对照。
        /// </summary>
        public static string Fingerprint(byte[] key)
        {
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(key);
                return "SHA256:" + Convert.ToBase64String(digest).Replace("=", string.Empty);
            }
        }

        /// <summary>校验并（首次）记住主机密钥。Mismatch 由调用方负责拒绝连接。</summary>
        public HostKeyVerdict Check(string host, int port, byte[] key)
        {
            var id = host + ":" + port.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var actual = Fingerprint(key);

            // 主机密钥校验发生在连接线程上，可能同时有多个会话在连
            lock (_gate)
            {
                var all = _store.Read();
                if (!all.TryGetValue(id, out var seen) || string.IsNullOrEmpty(seen))
                {
                    all[id] = actual;
                    _store.Write(all);
                    return HostKeyVerdict.New;
                }

                return seen == actual ? HostKeyVerdict.Match : HostKeyVerdict.Mismatch;
            }
        }

        /// <summary>密钥不一致时的说明文案，两个调用点（连接 / 测试连接）共用。</summary>
        public static string MismatchMessage(string host, int port, bool forTest)
        {
            var tail = forTest
                ? "。如果这台机器确实重装过系统或换过密钥，请删掉这条服务器记录后重新添加。"
                : "，已断开。如果这台机器确实重装过系统或换过密钥，请删掉这条服务器记录后重新添加。";
            return host + ":" + port + " 的主机密钥和上次连接时不一样，可能存在中间人攻击" + tail;
        }
    }
}
