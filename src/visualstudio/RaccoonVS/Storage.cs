using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace RaccoonVS
{
    /// <summary>
    /// 扩展的数据目录：%APPDATA%\RaccoonVS。
    ///
    /// 对应 VS Code 版的 globalState。VS 的扩展没有等价机制（写注册表或
    /// Program Files 下的安装目录都不合适），用用户目录最稳妥。
    /// </summary>
    internal static class AppData
    {
        public static string Directory { get; } = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RaccoonVS");

        public static string File(string name)
        {
            System.IO.Directory.CreateDirectory(Directory);
            return Path.Combine(Directory, name);
        }
    }

    /// <summary>
    /// 一个 JSON 落盘的小仓库。
    ///
    /// 写入走「临时文件 + 替换」：直接覆盖时如果进程被杀，留下的是半个文件，
    /// 下次启动整个列表都读不出来了。读的时候容忍坏数据，宁可丢一次也不抛。
    /// </summary>
    internal sealed class JsonStore<T> where T : class, new()
    {
        private readonly string _path;
        private readonly object _gate = new object();

        public JsonStore(string fileName)
        {
            _path = AppData.File(fileName);
        }

        public T Read()
        {
            lock (_gate)
            {
                try
                {
                    if (!File.Exists(_path))
                    {
                        return new T();
                    }
                    var json = File.ReadAllText(_path, Encoding.UTF8);
                    return JsonConvert.DeserializeObject<T>(json) ?? new T();
                }
                catch (Exception)
                {
                    // 外部被手改过、或者写到一半断电了：当作空的重来，
                    // 总好过让 VS 在启动路径上炸掉
                    return new T();
                }
            }
        }

        public void Write(T value)
        {
            lock (_gate)
            {
                try
                {
                    var json = JsonConvert.SerializeObject(value, Formatting.Indented);
                    var temporary = _path + ".tmp";
                    File.WriteAllText(temporary, json, new UTF8Encoding(false));

                    if (File.Exists(_path))
                    {
                        File.Replace(temporary, _path, null);
                    }
                    else
                    {
                        File.Move(temporary, _path);
                    }
                }
                catch (Exception)
                {
                    // 存不下来不该让调用方崩掉——上层已经收到成功回执，
                    // 下次改动会再写一遍
                }
            }
        }
    }

    /// <summary>
    /// 密码 / passphrase 的落盘存储，用 DPAPI 加密（对应 VS Code 版的 SecretStorage）。
    ///
    /// 用 CurrentUser 范围：密文只有同一台机器上的同一个用户能解开，
    /// 文件被拷走或者被别的账户读到都解不出明文。
    /// 服务器清单（servers.json）里只有主机名和用户名这类非敏感字段。
    /// </summary>
    internal sealed class SecretStore
    {
        private readonly JsonStore<Dictionary<string, string>> _store =
            new JsonStore<Dictionary<string, string>>("secrets.dat");

        public string Get(string key)
        {
            var all = _store.Read();
            if (!all.TryGetValue(key, out var encoded) || string.IsNullOrEmpty(encoded))
            {
                return null;
            }

            try
            {
                var encrypted = Convert.FromBase64String(encoded);
                var plain = System.Security.Cryptography.ProtectedData.Unprotect(
                    encrypted, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain);
            }
            catch (Exception)
            {
                // 换了用户或换了机器就解不开了，等同于「没存过」
                return null;
            }
        }

        public void Set(string key, string value)
        {
            var all = _store.Read();
            all[key] = Convert.ToBase64String(
                System.Security.Cryptography.ProtectedData.Protect(
                    Encoding.UTF8.GetBytes(value), null,
                    System.Security.Cryptography.DataProtectionScope.CurrentUser));
            _store.Write(all);
        }

        public void Remove(string key)
        {
            var all = _store.Read();
            if (all.Remove(key))
            {
                _store.Write(all);
            }
        }

        public bool Has(string key)
        {
            var all = _store.Read();
            return all.ContainsKey(key) && !string.IsNullOrEmpty(all[key]);
        }
    }
}
