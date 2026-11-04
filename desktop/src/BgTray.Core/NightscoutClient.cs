using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace BgTray.Core;

public sealed class NightscoutException : Exception
{
    public NightscoutException(string message, Exception? inner = null) : base(message, inner) { }
}

/// <summary>
/// Reads the newest sensor readings from a Nightscout site. Read-only: it calls only
/// <c>/api/v1/entries/sgv.json</c> and never writes anything. The token goes in the
/// <c>api-secret</c> header, as Nightscout accepts for a subject's access token.
/// </summary>
public sealed class NightscoutClient
{
    private readonly HttpClient _http;

    public NightscoutClient(HttpClient http)
    {
        _http = http;
    }

    public static Uri NormalizeBaseUrl(string url)
    {
        var trimmed = url.Trim().TrimEnd('/');
        if (!trimmed.Contains("://", StringComparison.Ordinal)) trimmed = "https://" + trimmed;
        var uri = new Uri(trimmed, UriKind.Absolute);
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            throw new NightscoutException("The site address must start with https://");
        return uri;
    }

    /// <summary>The newest readings, newest first. Throws <see cref="NightscoutException"/> with a sentence fit for the screen.</summary>
    public async Task<IReadOnlyList<Reading>> GetLatestAsync(string baseUrl, string token, int count = 2, CancellationToken ct = default)
    {
        var site = NormalizeBaseUrl(baseUrl);
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(site, $"/api/v1/entries/sgv.json?count={count}"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (!string.IsNullOrWhiteSpace(token)) request.Headers.TryAddWithoutValidation("api-secret", token.Trim());

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, ct).ConfigureAwait(false);
        }
        catch (HttpRequestException e)
        {
            throw new NightscoutException("Couldn't reach the site", e);
        }
        catch (TaskCanceledException e) when (!ct.IsCancellationRequested)
        {
            throw new NightscoutException("The site took too long to answer", e);
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new NightscoutException("The token was refused. Check it under Settings");
            if (!response.IsSuccessStatusCode)
                throw new NightscoutException($"The site answered {(int)response.StatusCode}");
            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return ParseEntries(body);
        }
    }

    public static IReadOnlyList<Reading> ParseEntries(string json)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException e)
        {
            throw new NightscoutException("The site answered something that isn't Nightscout data", e);
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw new NightscoutException("The site answered something that isn't Nightscout data");

            var readings = new List<Reading>();
            foreach (var entry in doc.RootElement.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object) continue;
                if (!entry.TryGetProperty("sgv", out var sgvProp) || sgvProp.ValueKind != JsonValueKind.Number) continue;
                if (!entry.TryGetProperty("date", out var dateProp) || dateProp.ValueKind != JsonValueKind.Number) continue;
                var sgv = (int)Math.Round(sgvProp.GetDouble());
                if (sgv <= 0) continue;
                var at = DateTimeOffset.FromUnixTimeMilliseconds((long)dateProp.GetDouble());
                var direction = entry.TryGetProperty("direction", out var dirProp) && dirProp.ValueKind == JsonValueKind.String
                    ? dirProp.GetString() ?? ""
                    : "";
                readings.Add(new Reading(at, sgv, direction));
            }
            return readings.OrderByDescending(r => r.At).ToList();
        }
    }
}
