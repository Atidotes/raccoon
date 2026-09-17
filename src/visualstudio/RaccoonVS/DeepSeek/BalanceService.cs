using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json;

namespace RaccoonVS.DeepSeek
{
    /// <summary>配置。VS 版没有工作区设置那一套，统一放 %APPDATA%\RaccoonVS\settings.json。</summary>
    internal sealed class Settings
    {
        [JsonProperty("apiKey")]
        public string ApiKey { get; set; }

        [JsonProperty("refreshIntervalMinutes")]
        public int RefreshIntervalMinutes { get; set; }
    }

    /// <summary>
    /// DeepSeek 余额的定时查询与状态栏显示，行为对齐 src/deepseek/statusBar.ts。
    ///
    /// 接口地址写死不做成配置项：如果让它可配置，恶意的工作区设置就能把请求指到
    /// 第三方服务器，而请求头里带着 API Key —— 那等于给了别人一个偷 Key 的口子。
    /// </summary>
    internal sealed class BalanceService : IDisposable
    {
        private const string BalanceUrl = "https://api.deepseek.com/user/balance";
        private const int DefaultIntervalMinutes = 10;
        private const int RequestTimeoutSeconds = 15;

        /// <summary>低于这个数就在状态栏标出警告，提醒该充值了。</summary>
        private const decimal LowBalanceThreshold = 10m;

        private static readonly Dictionary<string, string> CurrencySymbols =
            new Dictionary<string, string> { { "CNY", "¥" }, { "USD", "$" } };

        private readonly JsonStore<Settings> _settings = new JsonStore<Settings>("settings.json");
        private readonly HttpClient _http;

        private Timer _timer;
        private bool _disposed;
        private bool _running;

        public BalanceService()
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(RequestTimeoutSeconds) };
        }

        public void Start()
        {
            Schedule();
            Refresh();
        }

        public void Refresh()
        {
            // 上一次还没回来就不重复发请求（定时器与手点可能撞车）
            if (_disposed || _running)
            {
                return;
            }

            var apiKey = (_settings.Read().ApiKey ?? string.Empty).Trim();
            if (apiKey.Length == 0)
            {
                Render("DeepSeek：未配置 API Key", "settings.json 里填 apiKey");
                return;
            }

            _running = true;
            Render("DeepSeek：查询中…", null);

            _ = Task.Run(async () =>
            {
                try
                {
                    var balance = await FetchAsync(apiKey).ConfigureAwait(false);
                    RenderBalance(balance);
                }
                catch (Exception error)
                {
                    Render("DeepSeek：获取失败", error.Message);
                }
                finally
                {
                    _running = false;
                }
            });
        }

        private async Task<JObject> FetchAsync(string apiKey)
        {
            using (var request = new HttpRequestMessage(HttpMethod.Get, BalanceUrl))
            {
                request.Headers.Add("Authorization", "Bearer " + apiKey);
                request.Headers.Add("Accept", "application/json");

                using (var response = await _http.SendAsync(request).ConfigureAwait(false))
                {
                    var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                    if (!response.IsSuccessStatusCode)
                    {
                        throw new InvalidOperationException(ExplainStatus((int)response.StatusCode, body));
                    }

                    return JObject.Parse(body);
                }
            }
        }

        private static string ExplainStatus(int status, string body)
        {
            switch (status)
            {
                case 401:
                    return "API Key 无效或已撤销";
                case 402:
                    return "账户余额不足";
                case 429:
                    return "请求过于频繁，请稍后再试";
                default:
                    var detail = (body ?? string.Empty).Trim();
                    if (detail.Length > 200)
                    {
                        detail = detail.Substring(0, 200);
                    }
                    return detail.Length > 0 ? "HTTP " + status + "：" + detail : "HTTP " + status;
            }
        }

        private void RenderBalance(JObject balance)
        {
            var available = balance.Value<bool?>("is_available") ?? false;
            var infos = balance["balance_infos"] as JArray;
            var info = infos != null && infos.Count > 0 ? infos[0] : null;

            if (info == null)
            {
                Render("DeepSeek：获取失败", "接口没有返回任何余额信息");
                return;
            }

            var currency = info.Value<string>("currency") ?? "CNY";
            var total = info.Value<string>("total_balance") ?? "0";
            var granted = info.Value<string>("granted_balance") ?? "0";
            var topped = info.Value<string>("topped_up_balance") ?? "0";

            decimal amount;
            decimal.TryParse(total, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out amount);

            var low = amount < LowBalanceThreshold;
            var symbol = CurrencySymbols.ContainsKey(currency) ? CurrencySymbols[currency] : currency + " ";

            // 状态栏只有一行字，放不下 VS Code 版那份多行 tooltip，把要点压成一行
            var text = "DeepSeek " + symbol + total;
            if (!available || low)
            {
                text += "（余额不足）";
            }
            else
            {
                text += "（赠送 " + granted + " / 充值 " + topped + "）";
            }

            Render(text, null);
        }

        private void Render(string text, string tooltip)
        {
            // 这里可能跑在线程池线程上（定时器、HTTP 回调），VsShell.Status 自己会切回 UI 线程
            var message = string.IsNullOrEmpty(tooltip) ? text : text + " — " + tooltip;
            VsShell.Status(message);
        }

        private void Schedule()
        {
            _timer?.Dispose();

            var configured = _settings.Read().RefreshIntervalMinutes;
            // 兜底成默认值，避免有人填 0 或负数导致疯狂轮询
            var minutes = configured > 0 ? configured : DefaultIntervalMinutes;
            var period = TimeSpan.FromMinutes(minutes);

            _timer = new Timer(_ => Refresh(), null, period, period);
        }

        public void Dispose()
        {
            _disposed = true;
            _timer?.Dispose();
            _timer = null;
            _http.Dispose();
        }
    }
}
