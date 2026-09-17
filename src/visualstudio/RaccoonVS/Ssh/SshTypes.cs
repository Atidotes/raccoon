using System.Collections.Generic;
using Newtonsoft.Json;

namespace RaccoonVS.Ssh
{
    /// <summary>
    /// 表单提交上来的内容，对齐 src/ssh/types.ts 的 ServerDraft。
    /// 未填的可选字段是 null 而不是空串——序列化时会整个省略，前端读到的是 undefined。
    /// </summary>
    internal sealed class ServerDraft
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("host")]
        public string Host { get; set; }

        /// <summary>端口：表单里可能填的是字符串，解析交给 Validate.ParsePort。</summary>
        [JsonProperty("port")]
        public object Port { get; set; }

        [JsonProperty("username")]
        public string Username { get; set; }

        [JsonProperty("authMethod")]
        public string AuthMethod { get; set; }

        [JsonProperty("privateKeyPath")]
        public string PrivateKeyPath { get; set; }

        [JsonProperty("agentSocketPath")]
        public string AgentSocketPath { get; set; }

        /// <summary>留空表示「不改动已存的值」。</summary>
        [JsonProperty("password")]
        public string Password { get; set; }

        [JsonProperty("passphrase")]
        public string Passphrase { get; set; }
    }

    /// <summary>
    /// 一台服务器的持久化记录，对齐 ServerRecord。只含非敏感字段。
    /// 不密封：发给 webview 的形态（ServerListItem）在它基础上多两个布尔标记。
    /// </summary>
    internal class ServerRecord
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("host")]
        public string Host { get; set; }

        [JsonProperty("port")]
        public int Port { get; set; }

        [JsonProperty("username")]
        public string Username { get; set; }

        [JsonProperty("authMethod")]
        public string AuthMethod { get; set; }

        [JsonProperty("privateKeyPath")]
        public string PrivateKeyPath { get; set; }

        [JsonProperty("agentSocketPath")]
        public string AgentSocketPath { get; set; }
    }

    /// <summary>发给 webview 的形态：多两个「有没有存过」的布尔标记，不含任何明文密钥。</summary>
    internal sealed class ServerListItem : ServerRecord
    {
        [JsonProperty("hasStoredPassword")]
        public bool HasStoredPassword { get; set; }

        [JsonProperty("hasStoredPassphrase")]
        public bool HasStoredPassphrase { get; set; }
    }

    /// <summary>服务器清单落盘用的容器。</summary>
    internal sealed class ServerListFile
    {
        [JsonProperty("servers")]
        public List<ServerRecord> Servers { get; set; } = new List<ServerRecord>();
    }
}
