using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RaccoonVS.Ssh
{
    /// <summary>
    /// 服务器列表的读写，行为对齐 src/ssh/servers.ts 的 ServerStore。
    ///
    /// 存储分两层：
    ///   - 非敏感字段（主机、用户名、认证方式）→ %APPDATA%\RaccoonVS\servers.json
    ///   - 密码与私钥 passphrase → DPAPI 加密后存 secrets.dat
    /// 私钥本身只记路径不记内容，连接时现读——和 VS Code 版完全一致。
    /// </summary>
    internal sealed class ServerStore
    {
        private readonly JsonStore<ServerListFile> _store = new JsonStore<ServerListFile>("servers.json");
        private readonly SecretStore _secrets = new SecretStore();

        public List<ServerRecord> List()
        {
            return ReadAll();
        }

        public ServerRecord Get(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return null;
            }
            return ReadAll().FirstOrDefault(record => record.Id == id);
        }

        /// <summary>组装发给 webview 的列表：只多带两个「有没有存过」的布尔标记。</summary>
        public List<ServerListItem> ListForWebview()
        {
            return ReadAll().Select(record => new ServerListItem
            {
                Id = record.Id,
                Name = record.Name,
                Host = record.Host,
                Port = record.Port,
                Username = record.Username,
                AuthMethod = record.AuthMethod,
                PrivateKeyPath = record.PrivateKeyPath,
                AgentSocketPath = record.AgentSocketPath,
                HasStoredPassword = _secrets.Has(PasswordKey(record.Id)),
                HasStoredPassphrase = _secrets.Has(PassphraseKey(record.Id))
            }).ToList();
        }

        /// <summary>
        /// 新建或更新一台服务器。返回 null 表示成功，否则返回逐字段错误（直接回给表单）。
        /// </summary>
        public JObject Save(ServerDraft draft)
        {
            var errors = SshValidate.ValidateDraft(draft);
            if (errors.Count > 0)
            {
                return errors;
            }

            // 认不出 id 就当作新建，免得 webview 拿着过期 id 提交时静默什么都不发生
            var existing = Get(draft.Id);
            var record = SshValidate.ToRecord(draft, existing?.Id ?? Guid.NewGuid().ToString());

            var all = ReadAll();
            // 新记录排前面，刚加的机器一眼就能看到
            var next = new List<ServerRecord> { record };
            next.AddRange(all.Where(item => item.Id != record.Id));
            WriteAll(next);

            SyncSecret(
                PasswordKey(record.Id),
                record.AuthMethod == "password",
                draft.Password);
            SyncSecret(
                PassphraseKey(record.Id),
                record.AuthMethod == "privateKey",
                draft.Passphrase);

            return null;
        }

        public void Remove(string id)
        {
            WriteAll(ReadAll().Where(record => record.Id != id).ToList());
            // 记录没了，密钥也必须跟着走，否则文件里会攒下一堆孤儿密码
            _secrets.Remove(PasswordKey(id));
            _secrets.Remove(PassphraseKey(id));
        }

        public string Password(string id)
        {
            return _secrets.Get(PasswordKey(id));
        }

        public string Passphrase(string id)
        {
            return _secrets.Get(PassphraseKey(id));
        }

        /// <summary>
        /// 密钥的三态处理：认证方式用不上它 → 删掉；留空 → 保持原样；填了 → 覆盖。
        /// 不 trim：密码首尾的空格可能就是密码的一部分。
        /// </summary>
        private void SyncSecret(string key, bool relevant, string pending)
        {
            if (!relevant)
            {
                _secrets.Remove(key);
                return;
            }
            if (!string.IsNullOrEmpty(pending))
            {
                _secrets.Set(key, pending);
            }
        }

        private static string PasswordKey(string id)
        {
            return "password:" + id;
        }

        private static string PassphraseKey(string id)
        {
            return "passphrase:" + id;
        }

        /// <summary>
        /// 读全部记录。外部存储可能被手改过，形状不对的条目直接丢掉，
        /// 别让一条坏数据一路炸到连接时才报错。
        /// </summary>
        private List<ServerRecord> ReadAll()
        {
            var file = _store.Read();
            if (file?.Servers == null)
            {
                return new List<ServerRecord>();
            }

            return file.Servers.Where(IsValid).ToList();
        }

        private void WriteAll(List<ServerRecord> records)
        {
            _store.Write(new ServerListFile { Servers = records });
        }

        private static bool IsValid(ServerRecord record)
        {
            return record != null
                   && !string.IsNullOrEmpty(record.Id)
                   && !string.IsNullOrEmpty(record.Name)
                   && !string.IsNullOrEmpty(record.Host)
                   && !string.IsNullOrEmpty(record.Username)
                   && SshValidate.ParsePort(record.Port) != null;
        }
    }
}
