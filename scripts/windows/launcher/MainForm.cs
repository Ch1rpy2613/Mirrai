using System.Diagnostics;
using System.Drawing;
using System.Text;

namespace Mirrai.Launcher;

/// <summary>
/// A small window that starts Mirrai and shows what is happening while it
/// comes up. The first launch initialises a database, which takes a while, so
/// without this the user would have no idea whether anything was happening.
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly string _appDir;
    private readonly Label _status = new();
    private readonly Label _detail = new();
    private readonly ProgressBar _progress = new();
    private readonly TextBox _log = new();
    private readonly Button _openBrowser = new();
    private readonly Button _stop = new();

    private Process? _process;
    private bool _ready;
    private bool _closing;

    // The start script announces each stage; the first match wins.
    private static readonly (string Marker, int Percent, string Status)[] Stages =
    {
        ("Mirrai is starting", 5, "正在启动 Mirrai…"),
        ("Initializing database", 15, "正在初始化数据库…"),
        ("Database initialized", 30, "数据库已初始化"),
        ("Starting PostgreSQL", 40, "正在启动数据库服务…"),
        ("PostgreSQL started", 55, "数据库服务已就绪"),
        ("Ensuring database", 60, "正在准备业务数据库…"),
        ("Applying the WeChat channel migration", 68, "正在应用微信通道迁移…"),
        ("Synchronizing the database schema", 78, "正在同步表结构…"),
        ("Created config at", 85, "已生成配置文件"),
        ("Starting Mirrai server", 90, "正在启动服务…"),
        ("Administrator account created", 95, "管理员账号已生成，见日志"),
        ("Mirrai is running at", 100, "已就绪，正在打开浏览器…"),
    };

    public MainForm()
    {
        _appDir = AppContext.BaseDirectory;

        Text = "Mirrai";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(620, 460);
        BackColor = Color.FromArgb(250, 250, 252);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label
        {
            Text = "Mirrai",
            Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
            ForeColor = Color.FromArgb(30, 30, 40),
            AutoSize = true,
            Location = new Point(28, 22),
        };

        var subtitle = new Label
        {
            Text = "AI 数字分身 · 本地运行",
            ForeColor = Color.FromArgb(120, 120, 135),
            AutoSize = true,
            Location = new Point(30, 62),
        };

        _status.Text = "准备中…";
        _status.Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold);
        _status.ForeColor = Color.FromArgb(30, 30, 40);
        _status.AutoSize = true;
        _status.Location = new Point(28, 104);

        _detail.Text = "首次启动需要初始化数据库，可能要一两分钟，请不要关闭窗口。";
        _detail.ForeColor = Color.FromArgb(120, 120, 135);
        _detail.AutoSize = true;
        _detail.Location = new Point(30, 136);

        _progress.Location = new Point(28, 172);
        _progress.Size = new Size(564, 20);
        _progress.Style = ProgressBarStyle.Continuous;

        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.BackColor = Color.FromArgb(32, 34, 40);
        _log.ForeColor = Color.FromArgb(215, 218, 225);
        _log.Font = new Font("Consolas", 9F);
        _log.BorderStyle = BorderStyle.FixedSingle;
        _log.Location = new Point(28, 206);
        _log.Size = new Size(564, 186);

        _openBrowser.Text = "打开浏览器";
        _openBrowser.Size = new Size(110, 32);
        _openBrowser.Location = new Point(28, 408);
        _openBrowser.Enabled = false;
        _openBrowser.Click += (_, _) => OpenBrowser();

        _stop.Text = "停止并退出";
        _stop.Size = new Size(110, 32);
        _stop.Location = new Point(482, 408);
        _stop.Click += (_, _) => Close();

        Controls.AddRange(new Control[]
        {
            title, subtitle, _status, _detail, _progress, _log, _openBrowser, _stop,
        });

        FormClosing += OnFormClosing;
        Shown += (_, _) => BeginStartup();
    }

    // ─── Startup ────────────────────────────────────────────────────────────

    private void BeginStartup()
    {
        var script = Path.Combine(_appDir, "start.ps1");
        if (!File.Exists(script))
        {
            Fail("找不到启动脚本 start.ps1", "The start script is missing. Please reinstall Mirrai.");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
            WorkingDirectory = _appDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        try
        {
            _process = Process.Start(psi);
        }
        catch (Exception ex)
        {
            Fail("无法启动 Mirrai", ex.Message);
            return;
        }

        if (_process is null)
        {
            Fail("无法启动 Mirrai", "The start script could not be started.");
            return;
        }

        _process.OutputDataReceived += (_, e) => OnOutput(e.Data);
        _process.ErrorDataReceived += (_, e) => OnOutput(e.Data);
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _process.Exited += (_, _) => OnProcessExited();
    }

    private void OnOutput(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;

        if (line.Contains("ERROR:", StringComparison.OrdinalIgnoreCase))
        {
            Append("! " + line);
            return;
        }

        Append(line);

        foreach (var (marker, percent, status) in Stages)
        {
            if (!line.Contains(marker, StringComparison.OrdinalIgnoreCase)) continue;
            SetProgress(percent, status);
            if (percent == 100) OnReady();
            break;
        }
    }

    private void OnProcessExited()
    {
        if (_closing) return;
        BeginInvoke(() =>
        {
            if (_ready) return;
            Fail("Mirrai 启动失败", "Mirrai stopped before it finished starting up.");
        });
    }

    private void OnReady()
    {
        if (_ready) return;
        _ready = true;
        _openBrowser.Enabled = true;
        _status.Text = "已就绪";
        _detail.Text = "Mirrai 正在运行，本窗口保持打开。关掉它就会停止 Mirrai。";
        OpenBrowser();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private void SetProgress(int percent, string status)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _progress.Value = Math.Clamp(percent, 0, 100);
            _status.Text = status;
        });
    }

    private void Append(string line)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _log.AppendText(line.TrimEnd() + Environment.NewLine);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        });
    }

    private void Fail(string status, string detail)
    {
        _progress.Style = ProgressBarStyle.Continuous;
        _progress.Value = 0;
        _status.Text = status;
        _detail.Text = detail;
        _status.ForeColor = Color.FromArgb(180, 40, 50);
    }

    private static void OpenBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo("http://localhost:3000") { UseShellExecute = true });
        }
        catch
        {
            // The user can still open the address by hand.
        }
    }

    // ─── Shutdown ───────────────────────────────────────────────────────────

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        _closing = true;
        StopMirrai();
    }

    /// <summary>
    /// Stops the start script and everything it started, plus the database
    /// server, which pg_ctl leaves running outside of the script's tree.
    /// </summary>
    private void StopMirrai()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best effort.
        }

        try
        {
            var pgCtl = Path.Combine(_appDir, "pgsql", "bin", "pg_ctl.exe");
            var pgData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Mirrai", "pgdata");
            if (File.Exists(pgCtl) && Directory.Exists(pgData))
            {
                var psi = new ProcessStartInfo
                {
                    FileName = pgCtl,
                    Arguments = $"-D \"{pgData}\" -m fast stop",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using var pg = Process.Start(psi);
                pg?.WaitForExit(10000);
            }
        }
        catch
        {
            // Best effort.
        }
    }
}
