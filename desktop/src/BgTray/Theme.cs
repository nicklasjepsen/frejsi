using System.Windows.Media;
using BgTray.Core;
using Microsoft.Win32;

namespace BgTray;

/// <summary>Colours for the card and the tray icon. Low is red, high is amber, in range is green, stale is grey.</summary>
public static class Theme
{
    public static readonly Color Low = Color.FromRgb(0xE5, 0x48, 0x4D);
    public static readonly Color InRange = Color.FromRgb(0x2E, 0xB0, 0x6E);
    public static readonly Color High = Color.FromRgb(0xF0, 0xA2, 0x2E);
    public static readonly Color Stale = Color.FromRgb(0x8A, 0x8F, 0x98);

    public static Color For(RangeState state) => state switch
    {
        RangeState.Low => Low,
        RangeState.High => High,
        _ => InRange,
    };

    /// <summary>Windows' "Choose your default app mode" setting; dark when it can't be read.</summary>
    public static bool IsLightMode()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int v && v == 1;
        }
        catch
        {
            return false;
        }
    }

    public static System.Drawing.Color ToDrawing(Color c) => System.Drawing.Color.FromArgb(c.A, c.R, c.G, c.B);
}
