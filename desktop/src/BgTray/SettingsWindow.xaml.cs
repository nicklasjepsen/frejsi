using System.Globalization;
using System.Windows;
using BgTray.Core;

namespace BgTray;

public partial class SettingsWindow : Window
{
    private readonly NightscoutClient _client;
    private readonly AppSettings _original;

    public AppSettings Result { get; private set; }

    public SettingsWindow(AppSettings current, NightscoutClient client)
    {
        _client = client;
        _original = current;
        Result = current;
        InitializeComponent();

        SiteBox.Text = current.SiteUrl;
        TokenBox.Password = current.Token;
        MmolRadio.IsChecked = current.Unit == GlucoseUnit.MmolL;
        MgdlRadio.IsChecked = current.Unit == GlucoseUnit.MgDl;
        ShowThresholds(current.LowMmolL, current.HighMmolL, current.Unit);
        StartupBox.IsChecked = StartWithWindows.IsEnabled();
        Loaded += (_, _) =>
        {
            if (string.IsNullOrEmpty(SiteBox.Text)) SiteBox.Focus();
            else TokenBox.Focus();
        };
    }

    private GlucoseUnit SelectedUnit => MgdlRadio.IsChecked == true ? GlucoseUnit.MgDl : GlucoseUnit.MmolL;

    private void ShowThresholds(double lowMmol, double highMmol, GlucoseUnit unit)
    {
        var culture = CultureInfo.CurrentCulture;
        if (unit == GlucoseUnit.MmolL)
        {
            LowBox.Text = lowMmol.ToString("0.0", culture);
            HighBox.Text = highMmol.ToString("0.0", culture);
        }
        else
        {
            LowBox.Text = Glucose.ToMgDl(lowMmol).ToString(culture);
            HighBox.Text = Glucose.ToMgDl(highMmol).ToString(culture);
        }
        LowLabel.Text = $"Low below ({Glucose.UnitLabel(unit)})";
        HighLabel.Text = $"High above ({Glucose.UnitLabel(unit)})";
    }

    private void Unit_Changed(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded) return;
        // Convert what is typed so the numbers follow the unit instead of resetting.
        var previous = SelectedUnit == GlucoseUnit.MmolL ? GlucoseUnit.MgDl : GlucoseUnit.MmolL;
        if (TryReadThresholds(previous, out var low, out var high)) ShowThresholds(low, high, SelectedUnit);
        else ShowThresholds(_original.LowMmolL, _original.HighMmolL, SelectedUnit);
    }

    private bool TryReadThresholds(GlucoseUnit unit, out double lowMmol, out double highMmol)
    {
        lowMmol = highMmol = 0;
        var culture = CultureInfo.CurrentCulture;
        var styles = NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingWhite | NumberStyles.AllowTrailingWhite;
        var lowText = LowBox.Text.Replace(',', culture.NumberFormat.NumberDecimalSeparator[0]).Replace('.', culture.NumberFormat.NumberDecimalSeparator[0]);
        var highText = HighBox.Text.Replace(',', culture.NumberFormat.NumberDecimalSeparator[0]).Replace('.', culture.NumberFormat.NumberDecimalSeparator[0]);
        if (!double.TryParse(lowText, styles, culture, out var low) || !double.TryParse(highText, styles, culture, out var high)) return false;
        if (unit == GlucoseUnit.MgDl)
        {
            low = Glucose.ToMmolL((int)Math.Round(low));
            high = Glucose.ToMmolL((int)Math.Round(high));
        }
        if (low <= 0 || high <= low || high > 40) return false;
        lowMmol = Math.Round(low, 1);
        highMmol = Math.Round(high, 1);
        return true;
    }

    private async void Test_Click(object sender, RoutedEventArgs e)
    {
        TestButton.IsEnabled = false;
        TestResult.Text = "Asking the site…";
        try
        {
            var readings = await _client.GetLatestAsync(SiteBox.Text, TokenBox.Password, count: 1);
            TestResult.Text = readings.Count == 0
                ? "Connected, but the site has no readings yet."
                : $"Connected. Newest reading {Glucose.Format(readings[0].MgDl, SelectedUnit)} {Glucose.UnitLabel(SelectedUnit)}, {Glucose.AgeText(readings[0], DateTimeOffset.Now)}.";
        }
        catch (NightscoutException ex)
        {
            TestResult.Text = ex.Message + ".";
        }
        catch (UriFormatException)
        {
            TestResult.Text = "That doesn't look like a site address.";
        }
        finally
        {
            TestButton.IsEnabled = true;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        ErrorText.Visibility = Visibility.Collapsed;
        string site;
        try
        {
            site = NightscoutClient.NormalizeBaseUrl(SiteBox.Text).ToString().TrimEnd('/');
        }
        catch (Exception ex) when (ex is UriFormatException or NightscoutException)
        {
            Fail("Type the site's address, like https://ns.example.org.");
            return;
        }
        if (string.IsNullOrWhiteSpace(TokenBox.Password))
        {
            Fail("Paste the site's access token.");
            return;
        }
        if (!TryReadThresholds(SelectedUnit, out var low, out var high))
        {
            Fail("Low must be below high, and both must be numbers.");
            return;
        }

        var next = new AppSettings
        {
            SiteUrl = site,
            Unit = SelectedUnit,
            LowMmolL = low,
            HighMmolL = high,
            PollSeconds = _original.PollSeconds,
            ShowWindow = _original.ShowWindow,
            WindowLeft = _original.WindowLeft,
            WindowTop = _original.WindowTop,
        };
        next.Token = TokenBox.Password;
        try
        {
            StartWithWindows.Set(StartupBox.IsChecked == true);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or System.IO.IOException)
        {
            Fail("Couldn't change the start-up setting; everything else is saved.");
        }
        Result = next;
        DialogResult = true;
    }

    private void Fail(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }
}
