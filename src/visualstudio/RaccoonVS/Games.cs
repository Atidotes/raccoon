using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace RaccoonVS.Games
{
    /// <summary>
    /// 游戏的工具窗口基类，对齐 src/vscode/gamePanel.ts 的消息处理。
    ///
    /// 三个游戏共用一套协议：ready（回填最高分）、gameOver（可能破纪录）。
    /// 五子棋没有最高分，把 HighScoreKey 留空即可。
    /// </summary>
    public abstract class GameToolWindow : WebViewToolWindow
    {
        private const string HighScoreFile = "high_scores.json";

        private static readonly JsonStore<Dictionary<string, int>> Scores =
            new JsonStore<Dictionary<string, int>>(HighScoreFile);

        private readonly string _key;
        private readonly string _caption;

        protected GameToolWindow(string app, string caption, string highScoreKey)
            : base(new WebViewPanelHost(app))
        {
            _caption = caption;
            _key = highScoreKey;
            Caption = caption;
        }

        protected override void OnWebViewMessage(Envelope message)
        {
            switch (message.Command)
            {
                case Protocol.MsgReady:
                    PushTheme();
                    // 五子棋没有最高分，回 0 即可（前端只在有 HighScore 能力时才用这个值）
                    Host.Post(Message(Protocol.MsgHighScore, m => m["value"] = Best()));
                    break;

                case Protocol.MsgGameOver:
                {
                    var score = message.Int("score");
                    var win = message.Bool("win");
                    var isNewRecord = false;

                    // 通关（吃满整盘）不参与最高分评比，与 VS Code 版一致
                    if (_key != null && !win && score > Best())
                    {
                        isNewRecord = true;
                        SaveBest(score);
                        Host.Post(Message(Protocol.MsgHighScore, m => m["value"] = score));
                    }

                    Notify(message, score, isNewRecord);
                    break;
                }
            }
        }

        private int Best()
        {
            if (_key == null)
            {
                return 0;
            }
            var all = Scores.Read();
            return all.TryGetValue(_key, out var value) ? value : 0;
        }

        private void SaveBest(int score)
        {
            var all = Scores.Read();
            all[_key] = score;
            Scores.Write(all);
        }

        /// <summary>游戏结束的提示。文案与 VS Code 版逐字对齐，只把弹窗换成状态栏。</summary>
        private void Notify(Envelope message, int score, bool isNewRecord)
        {
            string text;

            if (message.Bool("win"))
            {
                text = "🐍 整盘吃满！得分：" + score + "｜长度：" + message.Int("length");
            }
            else if (isNewRecord)
            {
                text = "🏆 新纪录！" + _caption + " 最高分：" + score;
            }
            else if (_key == null)
            {
                // 五子棋不报分
                return;
            }
            else if (_caption.IndexOf("贪吃蛇", StringComparison.Ordinal) >= 0)
            {
                text = "贪吃蛇 — 得分：" + score + "｜长度：" + message.Int("length");
            }
            else
            {
                text = "Retro Tetris — 得分：" + score + "｜消行：" + message.Int("lines");
            }

            VsShell.Status(text);
        }
    }

    // 三个窗口类必须是 public 且只有无参构造函数：VS 用 Activator.CreateInstance
    // 创建工具窗口实例，类型不可见或缺无参构造都会在第一次点击菜单时炸。
    public sealed class TetrisToolWindow : GameToolWindow
    {
        public TetrisToolWindow()
            : base("tetris", "🎮 俄罗斯方块", "tetris")
        {
        }
    }

    public sealed class SnakeToolWindow : GameToolWindow
    {
        public SnakeToolWindow()
            : base("snake", "🐍 贪吃蛇", "snake")
        {
        }
    }

    /// <summary>五子棋：游戏状态全在网页里，没有最高分。</summary>
    public sealed class GomokuToolWindow : GameToolWindow
    {
        public GomokuToolWindow()
            : base("gomoku", "⚫⚪ 五子棋", null)
        {
        }
    }
}
