using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using BgTray.Core;

namespace BgTray;

/// <summary>The small always-on-top card: value, arrow, change, and always the age.</summary>
public partial class MainWindow : Window
{
    private readonly App _app;

    public MainWindow(App app)
    {
        _app = app;
        InitializeComponent();
        LocationChanged += (_, _) =>
        {
            if (IsVisible && IsLoaded) _app.RememberWindowPosition(Left, Top);
        };
    }

    public void ShowCard(AppSettings settings)
    {
        if (settings.WindowLeft is double left && settings.WindowTop is double top && OnAScreen(left, top))
        {
            Left = left;
            Top = top;
        }
        else
        {
            var area = SystemParameters.WorkArea;
            Left = area.Right - Width - 12;
            Top = area.Bottom - 120;
        }
        Show();
    }

    private static bool OnAScreen(double left, double top)
    {
        var virt = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
            SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        return virt.Contains(new Point(left + 40, top + 20));
    }

    public void ShowEmpty(string message)
    {
        ValueText.Text = "--";
        ArrowText.Text = "";
        DeltaText.Text = "";
        AgeText.Text = "No reading yet";
        RangeBar.Background = new SolidColorBrush(Theme.Stale);
        SetProblem(message);
    }

    public void ShowReading(Reading reading, Reading? previous, AppSettings settings, DateTimeOffset now, string? problem)
    {
        var stale = Glucose.IsStale(reading, now);
        var color = stale ? Theme.Stale : Theme.For(Glucose.Classify(reading.MgDl, settings.LowMmolL, settings.HighMmolL));
        ValueText.Text = Glucose.Format(reading.MgDl, settings.Unit);
        ValueText.Opacity = stale ? 0.55 : 1;
        ArrowText.Text = stale ? "" : Glucose.Arrow(reading.Direction);
        DeltaText.Text = stale ? "" : Glucose.FormatDelta(reading, previous, settings.Unit) ?? "";
        AgeText.Text = $"{Glucose.AgeText(reading, now)} · {Glucose.UnitLabel(settings.Unit)}";
        RangeBar.Background = new SolidColorBrush(color);
        SetProblem(problem);
    }

    private void SetProblem(string? problem)
    {
        ProblemText.Text = problem ?? "";
        ProblemText.Visibility = string.IsNullOrEmpty(problem) ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Card_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            _app.OpenSettings();
            return;
        }
        try
        {
            DragMove();
        }
        catch (InvalidOperationException)
        {
            // The button was released before the drag began.
        }
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => _app.RefreshNow();

    private void Settings_Click(object sender, RoutedEventArgs e) => _app.OpenSettings();

    private void Hide_Click(object sender, RoutedEventArgs e)
    {
        Hide();
        _app.Settings.ShowWindow = false;
        _app.SaveQuietly();
    }
}
