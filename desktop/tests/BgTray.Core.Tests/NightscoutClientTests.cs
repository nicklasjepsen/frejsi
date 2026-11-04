using System.Net;
using BgTray.Core;
using Xunit;

namespace BgTray.Core.Tests;

public class NightscoutClientTests
{
    // The shape Nightscout 15 returns from /api/v1/entries/sgv.json?count=2, values made up.
    private const string Fixture = """
        [
          {"_id":"a","sgv":151,"date":1793016000000,"dateString":"2026-10-27T10:00:00.000Z","direction":"FortyFiveUp","type":"sgv","device":"share2"},
          {"_id":"b","sgv":145,"date":1793015700000,"dateString":"2026-10-27T09:55:00.000Z","direction":"Flat","type":"sgv","device":"share2"}
        ]
        """;

    [Fact]
    public void ParsesEntriesNewestFirst()
    {
        var readings = NightscoutClient.ParseEntries(Fixture);
        Assert.Equal(2, readings.Count);
        Assert.Equal(151, readings[0].MgDl);
        Assert.Equal("FortyFiveUp", readings[0].Direction);
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(1793016000000), readings[0].At);
        Assert.Equal(145, readings[1].MgDl);
    }

    [Fact]
    public void SkipsEntriesWithoutAValue()
    {
        var readings = NightscoutClient.ParseEntries("""[{"sgv":0,"date":1},{"mbg":120,"date":2},{"sgv":99,"date":3}]""");
        Assert.Single(readings);
        Assert.Equal(99, readings[0].MgDl);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"status\":\"ok\"}")]
    public void RefusesSomethingThatIsNotEntries(string body) =>
        Assert.Throws<NightscoutException>(() => NightscoutClient.ParseEntries(body));

    [Theory]
    [InlineData("ns.example.org", "https://ns.example.org/")]
    [InlineData("https://ns.example.org/", "https://ns.example.org/")]
    [InlineData("  https://ns.example.org/some/path/ ", "https://ns.example.org/some/path")]
    public void NormalizesTheSiteAddress(string input, string expected) =>
        Assert.Equal(expected, NightscoutClient.NormalizeBaseUrl(input).ToString());

    [Fact]
    public async Task SendsTheTokenInTheApiSecretHeaderAndReadsOnlyEntries()
    {
        var handler = new StubHandler(HttpStatusCode.OK, Fixture);
        var client = new NightscoutClient(new HttpClient(handler));
        var readings = await client.GetLatestAsync("https://ns.example.org", "tok-123");
        Assert.Equal(2, readings.Count);
        Assert.Equal(HttpMethod.Get, handler.Request!.Method);
        Assert.Equal("https://ns.example.org/api/v1/entries/sgv.json?count=2", handler.Request.RequestUri!.ToString());
        Assert.Equal("tok-123", handler.Request.Headers.GetValues("api-secret").Single());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "token was refused")]
    [InlineData(HttpStatusCode.InternalServerError, "answered 500")]
    public async Task ExplainsRefusalsInPlainWords(HttpStatusCode status, string fragment)
    {
        var client = new NightscoutClient(new HttpClient(new StubHandler(status, "")));
        var e = await Assert.ThrowsAsync<NightscoutException>(() => client.GetLatestAsync("https://ns.example.org", "x"));
        Assert.Contains(fragment, e.Message);
    }

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }
}
