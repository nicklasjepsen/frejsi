using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using BgTray.Core;

namespace BgTray;

/// <summary>
/// What the app remembers, in <c>%AppData%\Frejsi\Desktop\settings.json</c>. The token is stored
/// encrypted with Windows DPAPI for the current user, so the file holds no readable secret.
/// </summary>
public sealed class AppSettings
{
    public string SiteUrl { get; set; } = "";
    public string TokenProtected { get; set; } = "";
    public GlucoseUnit Unit { get; set; } = GlucoseUnit.MmolL;
    public double LowMmolL { get; set; } = 3.9;
    public double HighMmolL { get; set; } = 10.0;
    public int PollSeconds { get; set; } = 60;
    public bool ShowWindow { get; set; } = true;
    public double? WindowLeft { get; set; }
    public double? WindowTop { get; set; }

    [JsonIgnore]
    public bool IsConfigured => !string.IsNullOrWhiteSpace(SiteUrl) && !string.IsNullOrWhiteSpace(TokenProtected);

    public static string Directory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Frejsi", "Desktop");

    private static string FilePath => Path.Combine(Directory, "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public static AppSettings Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), JsonOptions) ?? new AppSettings();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new AppSettings();
        }
    }

    public void Save()
    {
        System.IO.Directory.CreateDirectory(Directory);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, JsonOptions));
    }

    public string Token
    {
        get
        {
            if (string.IsNullOrEmpty(TokenProtected)) return "";
            try
            {
                var bytes = ProtectedData.Unprotect(Convert.FromBase64String(TokenProtected), null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(bytes);
            }
            catch (Exception e) when (e is CryptographicException or FormatException)
            {
                return "";
            }
        }
        set
        {
            TokenProtected = string.IsNullOrEmpty(value)
                ? ""
                : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value.Trim()), null, DataProtectionScope.CurrentUser));
        }
    }
}
