using Microsoft.Win32;

namespace BgTray;

/// <summary>The per-user Run key: no admin rights, removable from Task Manager → Startup like any other app.</summary>
public static class StartWithWindows
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "NaensomDesktop";
    private const string LegacyValueName = "FrejsiDesktop";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
        return key?.GetValue(ValueName) is string;
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        if (key is null) return;
        if (enabled)
        {
            var exe = Environment.ProcessPath;
            if (exe is null) return;
            key.SetValue(ValueName, $"\"{exe}\"");
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }

    /// <summary>
    /// The app was called Frejsi and its Run value pointed at FrejsiDesktop.exe. If that value is
    /// there, drop it and start this exe instead, so the choice the person made carries over.
    /// </summary>
    public static void MoveFromOldName()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        if (key?.GetValue(LegacyValueName) is not string) return;
        key.DeleteValue(LegacyValueName, throwOnMissingValue: false);
        Set(true);
    }
}
