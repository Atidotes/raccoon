using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace RaccoonVS.Pdf
{
    /// <summary>
    /// 把 Markdown 里指向本地文件的相对链接改写成 file:// 绝对地址，
    /// 这样导出的 PDF 里点击链接能直接打开对应的本地文件。
    ///
    /// 逻辑对齐 src/markdown/markdownToPdf.ts 的 rewriteLinks：解析不了一律原样返回，
    /// 绝不破坏原文；代码围栏里的内容跳过。
    /// </summary>
    internal static class LinkRewriter
    {
        private static readonly Regex LinkPattern = new Regex(@"\[([^\]]*)\]\(([^)]+)\)", RegexOptions.Compiled);
        private static readonly Regex AbsolutePattern = new Regex(@"^(https?:|mailto:|#|/)", RegexOptions.Compiled);

        public static string Rewrite(string markdown, string baseDirectory)
        {
            var lines = (markdown ?? string.Empty).Split('\n');
            var output = new List<string>(lines.Length);
            var inFence = false;

            foreach (var line in lines)
            {
                if (line.TrimStart().StartsWith("```", StringComparison.Ordinal))
                {
                    inFence = !inFence;
                    output.Add(line);
                    continue;
                }

                output.Add(inFence
                    ? line
                    : LinkPattern.Replace(line, match => RewriteOne(match, baseDirectory)));
            }

            return string.Join("\n", output);
        }

        private static string RewriteOne(Match match, string baseDirectory)
        {
            var label = match.Groups[1].Value;
            var rawTarget = match.Groups[2].Value;
            var target = rawTarget.Trim();

            if (AbsolutePattern.IsMatch(target))
            {
                return Original(label, rawTarget);
            }

            var hashAt = target.IndexOf('#');
            var pathPart = hashAt == -1 ? target : target.Substring(0, hashAt);
            var anchor = hashAt == -1 ? string.Empty : target.Substring(hashAt);

            string decoded;
            try
            {
                decoded = Uri.UnescapeDataString(pathPart);
            }
            catch (Exception)
            {
                return Original(label, rawTarget);
            }

            if (string.IsNullOrEmpty(decoded) || decoded.StartsWith(".", StringComparison.Ordinal))
            {
                return Original(label, rawTarget);
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(Path.Combine(baseDirectory, decoded));
            }
            catch (Exception)
            {
                // 路径里有非法字符（Windows 上很常见），原样保留
                return Original(label, rawTarget);
            }

            if (!File.Exists(fullPath))
            {
                return Original(label, rawTarget);
            }

            return "[" + label + "](" + new Uri(fullPath).AbsoluteUri + anchor + ")";
        }

        private static string Original(string label, string rawTarget)
        {
            return "[" + label + "](" + rawTarget + ")";
        }
    }
}
