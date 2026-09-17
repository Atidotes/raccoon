using System;
using System.Globalization;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace RaccoonVS.Ssh
{
    /// <summary>
    /// 表单校验，逐条对齐 src/ssh/validate.ts。
    ///
    /// 校验以宿主为准：webview 上那点即时反馈只是顺手，真正的规则在这里。
    /// 两边必须一致——同一份表单，在 VS Code 里报的错和在这里报的错不能不一样。
    /// </summary>
    internal static class SshValidate
    {
        public const int DefaultPort = 22;

        private static readonly string[] AuthMethods = { "password", "privateKey", "agent" };

        private static readonly Regex DigitsOnly = new Regex("^\\d+$", RegexOptions.Compiled);
        private static readonly Regex HostForbidden = new Regex("[\\s@/\\\\]", RegexOptions.Compiled);
        private static readonly Regex BracketedHost = new Regex("^\\[[^\\]]+\\]$", RegexOptions.Compiled);

        /// <summary>webview 传来的值不可信，认证方式要收敛到已知取值。</summary>
        public static string ParseAuthMethod(object value)
        {
            var text = value as string;
            if (text != null)
            {
                foreach (var method in AuthMethods)
                {
                    if (method == text)
                    {
                        return method;
                    }
                }
            }
            return "password";
        }

        /// <summary>
        /// 端口：接受数字或纯数字字符串，返回 1–65535 的整数；其余情况返回 null。
        ///
        /// 前端发来的 port 可能是 JSON number 也可能是 string（表单里是文本框），
        /// 所以入参用 object 而不是 int，跟 TS 侧的 unknown 对应。
        /// </summary>
        public static int? ParsePort(object value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is long || value is int)
            {
                var number = Convert.ToInt64(value, CultureInfo.InvariantCulture);
                return number >= 1 && number <= 65535 ? (int?)number : null;
            }

            var text = value as string;
            if (text == null)
            {
                return null;
            }

            var trimmed = text.Trim();
            if (!DigitsOnly.IsMatch(trimmed))
            {
                return null;
            }

            int port;
            if (!int.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out port))
            {
                return null;
            }
            return port >= 1 && port <= 65535 ? (int?)port : null;
        }

        /// <summary>
        /// 主机名或地址：域名、IPv4、IPv6（裸写或 [] 包起来）都要能过。
        ///
        /// 只挡明显非法的字符，不做严格格式校验——内网里合法的主机名五花八门，
        /// 卡太严会把用户真正在用的机器挡在门外。
        /// </summary>
        public static string ValidateHost(object value)
        {
            var text = value as string;
            if (string.IsNullOrWhiteSpace(text))
            {
                return "请填写主机地址";
            }
            if (HostForbidden.IsMatch(text.Trim()))
            {
                return "主机地址里不能有空格、@ 或斜杠";
            }
            return null;
        }

        /// <summary>去掉 IPv6 的方括号：表单里写 [::1] 不容易看错，但连接要的是裸地址。</summary>
        public static string NormalizeHost(string value)
        {
            var host = (value ?? string.Empty).Trim();
            return BracketedHost.IsMatch(host) ? host.Substring(1, host.Length - 2) : host;
        }

        /// <summary>校验表单。返回空字典即通过。</summary>
        public static JObject ValidateDraft(ServerDraft draft)
        {
            var errors = new JObject();

            if (string.IsNullOrWhiteSpace(draft?.Name))
            {
                errors["name"] = "请给这台机器起个名字";
            }

            var hostError = ValidateHost(draft?.Host);
            if (hostError != null)
            {
                errors["host"] = hostError;
            }

            if (ParsePort(draft?.Port) == null)
            {
                errors["port"] = "端口必须是 1–65535 之间的整数";
            }

            if (string.IsNullOrWhiteSpace(draft?.Username))
            {
                errors["username"] = "请填写登录用户名";
            }

            if (ParseAuthMethod(draft?.AuthMethod) == "privateKey"
                && string.IsNullOrWhiteSpace(draft?.PrivateKeyPath))
            {
                errors["privateKeyPath"] = "请填写私钥文件路径";
            }

            return errors;
        }

        /// <summary>把 draft 收敛成一条合法记录（校验通过后调用）。</summary>
        public static ServerRecord ToRecord(ServerDraft draft, string id)
        {
            return new ServerRecord
            {
                Id = id,
                Name = (draft.Name ?? string.Empty).Trim(),
                Host = NormalizeHost(draft.Host),
                Port = ParsePort(draft.Port) ?? DefaultPort,
                Username = (draft.Username ?? string.Empty).Trim(),
                AuthMethod = ParseAuthMethod(draft.AuthMethod),
                PrivateKeyPath = Trimmed(draft.PrivateKeyPath),
                AgentSocketPath = Trimmed(draft.AgentSocketPath)
            };
        }

        private static string Trimmed(string value)
        {
            var text = (value ?? string.Empty).Trim();
            return text.Length == 0 ? null : text;
        }
    }
}
