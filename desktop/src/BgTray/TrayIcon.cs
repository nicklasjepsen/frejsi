using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using BgTray.Core;

namespace BgTray;

/// <summary>
/// The icon in the notification area: a rounded tile in the range colour with the value on it.
/// A stale reading shows "--" on a grey tile, because the icon is too small for an age, and a
/// value without its age is a value you might act on without knowing it is old.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private IntPtr _handle;

    public event EventHandler? ToggleRequested;
    public event EventHandler? SettingsRequested;
    public event EventHandler? RefreshRequested;
    public event EventHandler? QuitRequested;

    public TrayIcon()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Show / hide", null, (_, _) => ToggleRequested?.Invoke(this, EventArgs.Empty));
        menu.Items.Add("Refresh now", null, (_, _) => RefreshRequested?.Invoke(this, EventArgs.Empty));
        menu.Items.Add("Settings…", null, (_, _) => SettingsRequested?.Invoke(this, EventArgs.Empty));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => QuitRequested?.Invoke(this, EventArgs.Empty));

        _icon = new NotifyIcon
        {
            ContextMenuStrip = menu,
            Visible = true,
            Text = "Nænsom",
        };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ToggleRequested?.Invoke(this, EventArgs.Empty);
        };
        SetPlaceholder("…");
    }

    public void SetPlaceholder(string text) => Render(text, Theme.ToDrawing(Theme.Stale), "Nænsom");

    public void Show(Reading reading, GlucoseUnit unit, double low, double high, DateTimeOffset now, string? problem)
    {
        var stale = Glucose.IsStale(reading, now);
        var color = stale ? Theme.Stale : Theme.For(Glucose.Classify(reading.MgDl, low, high));
        var value = Glucose.Format(reading.MgDl, unit);
        var tip = $"{value} {Glucose.UnitLabel(unit)} {Glucose.Arrow(reading.Direction)} · {Glucose.AgeText(reading, now)}".Trim();
        if (problem is not null) tip += $"\n{problem}";
        // NotifyIcon.Text is limited to 127 characters.
        if (tip.Length > 127) tip = tip[..127];
        Render(stale ? "--" : value, Theme.ToDrawing(color), tip);
    }

    private void Render(string text, Color fill, string tooltip)
    {
        const int size = 32;
        using var bitmap = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);
            using var path = RoundedRect(new Rectangle(0, 0, size - 1, size - 1), 8);
            using var brush = new SolidBrush(fill);
            g.FillPath(brush, path);

            var fontSize = text.Length <= 2 ? 15f : text.Length == 3 ? 13f : 11f;
            using var font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
            using var format = new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.NoWrap,
            };
            g.DrawString(text, font, Brushes.White, new RectangleF(0, 0, size, size), format);
        }

        var newHandle = bitmap.GetHicon();
        var oldHandle = _handle;
        _handle = newHandle;
        _icon.Icon = Icon.FromHandle(newHandle);
        _icon.Text = tooltip;
        if (oldHandle != IntPtr.Zero) DestroyIcon(oldHandle);
    }

    private static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        if (_handle != IntPtr.Zero) DestroyIcon(_handle);
        _handle = IntPtr.Zero;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr handle);
}
