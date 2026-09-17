using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RaccoonVS
{
    /// <summary>
    /// 消息名常量，逐条对齐 src/shared/protocol.ts。
    ///
    /// 前端是同一份构建产物，两端的消息名必须一模一样——改了那边就要改这边。
    /// 这里只放字符串常量，不做类型镜像：C# 侧统一按 command 分发，具体字段
    /// 在各自的处理器里按需读取。
    /// </summary>
    internal static class Protocol
    {
        // 游戏
        public const string MsgReady = "ready";
        public const string MsgHighScore = "highScore";
        public const string MsgGameOver = "gameOver";

        // 主题（Visual Studio 专属：WebView2 拿不到 VS 的配色，由宿主下发）
        public const string MsgTheme = "theme";
        public const string ThemeLight = "light";
        public const string ThemeDark = "dark";

        // SSH：webview → 宿主
        public const string MsgSshReady = "ssh:ready";
        public const string MsgSshSave = "ssh:saveServer";
        public const string MsgSshDelete = "ssh:deleteServer";
        public const string MsgSshConnect = "ssh:connect";
        public const string MsgSshClose = "ssh:closeSession";
        public const string MsgSshInput = "ssh:input";
        public const string MsgSshResize = "ssh:resize";
        public const string MsgSshTest = "ssh:testConnection";

        // SSH：宿主 → webview
        public const string MsgSshServers = "ssh:servers";
        public const string MsgSshStatus = "ssh:status";
        public const string MsgSshData = "ssh:data";
        public const string MsgSshTestResult = "ssh:testResult";
        public const string MsgSshFormError = "ssh:formError";
    }

    /// <summary>
    /// 从 webview 收到的信封：只取 command，其余字段按需读。
    /// 不镜像 TS 的类型定义，免得两处维护、两边漂移。
    /// </summary>
    internal sealed class Envelope
    {
        [JsonProperty("command")]
        public string Command { get; set; }

        /// <summary>
        /// 除 command 外的原始字段。用 JObject 而不是逐字段属性：
        /// 协议里有很多可选字段（比如不同游戏发不同的 gameOver 字段）。
        /// </summary>
        [JsonExtensionData]
        public JObject Extra { get; set; }

        public string String(string name)
        {
            var token = Extra?[name];
            return token == null || token.Type == JTokenType.Null ? null : token.ToString();
        }

        public int Int(string name, int fallback = 0)
        {
            var token = Extra?[name];
            if (token == null || token.Type == JTokenType.Null)
            {
                return fallback;
            }
            return token.Type == JTokenType.Integer ? token.Value<int>() : fallback;
        }

        public bool Bool(string name)
        {
            var token = Extra?[name];
            return token != null && token.Type == JTokenType.Boolean && token.Value<bool>();
        }

        /// <summary>取一条子对象（如 draft），没有就返回 null。</summary>
        public T Object<T>(string name) where T : class
        {
            var token = Extra?[name];
            if (token == null || token.Type != JTokenType.Object)
            {
                return null;
            }
            return token.ToObject<T>();
        }
    }
}
