using System.Net.Http;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using BgTray.Core;

namespace BgTray;

public partial class App : Application
{
    private static Mutex? _single;

    private readonly NightscoutClient _client = new(new HttpClient { Timeout = TimeSpan.FromSeconds(15) });
    private readonly DispatcherTimer _poll = new();
    private readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromSeconds(15) };

    private AppSettings _settings = new();
    private TrayIcon? _tray;
    private MainWindow? _window;
    private Reading? _latest;
    private Reading? _previous;
    private string? _problem;
    private bool _fetching;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _single = new Mutex(initiallyOwned: true, "Naensom.Desktop.SingleInstance", out var first);
        if (!first)
        {
            Shutdown();
            return;
        }

        ApplyPalette();
        _settings = AppSettings.Load();
        StartWithWindows.MoveFromOldName();

        _tray = new TrayIcon();
        _tray.ToggleRequested += (_, _) => ToggleWindow();
        _tray.SettingsRequested += (_, _) => OpenSettings();
        _tray.RefreshRequested += (_, _) => _ = FetchAsync();
        _tray.QuitRequested += (_, _) => Shutdown();

        _window = new MainWindow(this);
        if (_settings.ShowWindow) _window.ShowCard(_settings);

        _poll.Tick += (_, _) => _ = FetchAsync();
        _tick.Tick += (_, _) => Render();
        _tick.Start();

        if (_settings.IsConfigured) StartPolling();
        else OpenSettings();
    }

    public AppSettings Settings => _settings;

    public void RefreshNow() => _ = FetchAsync();

    private void ApplyPalette()
    {
        if (!Theme.IsLightMode()) return;
        Resources["CardBackground"] = new SolidColorBrush(Color.FromArgb(0xF5, 0xFF, 0xFF, 0xFF));
        Resources["CardBorder"] = new SolidColorBrush(Color.FromArgb(0x22, 0x00, 0x00, 0x00));
        Resources["TextPrimary"] = new SolidColorBrush(Color.FromArgb(0xEE, 0x1A, 0x1C, 0x20));
        Resources["TextSecondary"] = new SolidColorBrush(Color.FromArgb(0x99, 0x1A, 0x1C, 0x20));
    }

    private void StartPolling()
    {
        _poll.Stop();
        _poll.Interval = TimeSpan.FromSeconds(Math.Clamp(_settings.PollSeconds, 30, 600));
        _poll.Start();
        _ = FetchAsync();
    }

    private async Task FetchAsync()
    {
        if (_fetching || !_settings.IsConfigured) return;
        _fetching = true;
        try
        {
            var readings = await _client.GetLatestAsync(_settings.SiteUrl, _settings.Token);
            if (readings.Count == 0)
            {
                _problem = "The site has no readings";
            }
            else
            {
                _latest = readings[0];
                _previous = readings.Count > 1 ? readings[1] : null;
                _problem = null;
            }
        }
        catch (NightscoutException ex)
        {
            _problem = ex.Message;
        }
        finally
        {
            _fetching = false;
            Render();
        }
    }

    private void Render()
    {
        var now = DateTimeOffset.Now;
        if (_latest is null)
        {
            _tray?.SetPlaceholder(_settings.IsConfigured ? "…" : "?");
            _window?.ShowEmpty(_settings.IsConfigured ? (_problem ?? "Waiting for the first reading…") : "Open Settings to connect your Nightscout site");
            return;
        }
        _tray?.Show(_latest, _settings.Unit, _settings.LowMmolL, _settings.HighMmolL, now, _problem);
        _window?.ShowReading(_latest, _previous, _settings, now, _problem);
    }

    private void ToggleWindow()
    {
        if (_window is null) return;
        if (_window.IsVisible)
        {
            _window.Hide();
            _settings.ShowWindow = false;
        }
        else
        {
            _window.ShowCard(_settings);
            _settings.ShowWindow = true;
            Render();
        }
        SaveQuietly();
    }

    public void RememberWindowPosition(double left, double top)
    {
        _settings.WindowLeft = left;
        _settings.WindowTop = top;
        SaveQuietly();
    }

    public void OpenSettings()
    {
        var dialog = new SettingsWindow(_settings, _client);
        if (_window is { IsVisible: true }) dialog.Owner = _window;
        if (dialog.ShowDialog() == true)
        {
            _settings = dialog.Result;
            SaveQuietly();
            _latest = null;
            _previous = null;
            _problem = null;
            Render();
            if (_settings.IsConfigured) StartPolling();
        }
    }

    public void SaveQuietly()
    {
        try
        {
            _settings.Save();
        }
        catch (Exception ex) when (ex is System.IO.IOException or UnauthorizedAccessException)
        {
            _problem = "Couldn't save settings";
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _poll.Stop();
        _tick.Stop();
        _tray?.Dispose();
        _single?.Dispose();
        base.OnExit(e);
    }
}
