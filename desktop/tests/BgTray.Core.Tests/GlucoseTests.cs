using System.Globalization;
using BgTray.Core;
using Xunit;

namespace BgTray.Core.Tests;

public class GlucoseTests
{
    private static readonly CultureInfo Da = CultureInfo.GetCultureInfo("da-DK");
    private static readonly CultureInfo En = CultureInfo.InvariantCulture;
    private static readonly DateTimeOffset Now = new(2026, 11, 4, 10, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(180, 10.0)]
    [InlineData(70, 3.9)]
    [InlineData(151, 8.4)]
    [InlineData(39, 2.2)]
    public void ConvertsMgDlToMmolL(int mgDl, double expected) =>
        Assert.Equal(expected, Glucose.ToMmolL(mgDl));

    [Fact]
    public void FormatsWithTheCulturesSeparator()
    {
        Assert.Equal("8,4", Glucose.Format(151, GlucoseUnit.MmolL, Da));
        Assert.Equal("8.4", Glucose.Format(151, GlucoseUnit.MmolL, En));
        Assert.Equal("151", Glucose.Format(151, GlucoseUnit.MgDl, Da));
    }

    [Fact]
    public void DeltaIsSignedAndNullWhenTheReadingsAreTooFarApart()
    {
        var current = new Reading(Now, 151, "Flat");
        var fiveMinAgo = new Reading(Now.AddMinutes(-5), 145, "Flat");
        var anHourAgo = new Reading(Now.AddHours(-1), 145, "Flat");
        Assert.Equal("+0.3", Glucose.FormatDelta(current, fiveMinAgo, GlucoseUnit.MmolL, En));
        Assert.Equal("−0.3", Glucose.FormatDelta(fiveMinAgo, current with { At = Now.AddMinutes(-10) }, GlucoseUnit.MmolL, En));
        Assert.Equal("+6", Glucose.FormatDelta(current, fiveMinAgo, GlucoseUnit.MgDl, En));
        Assert.Null(Glucose.FormatDelta(current, anHourAgo, GlucoseUnit.MmolL, En));
        Assert.Null(Glucose.FormatDelta(current, null, GlucoseUnit.MmolL, En));
    }

    [Theory]
    [InlineData("Flat", "→")]
    [InlineData("FortyFiveUp", "↗")]
    [InlineData("DoubleDown", "⇊")]
    [InlineData("NOT COMPUTABLE", "")]
    [InlineData(null, "")]
    public void ArrowsFollowNightscoutDirections(string? direction, string arrow) =>
        Assert.Equal(arrow, Glucose.Arrow(direction));

    [Theory]
    [InlineData(69, RangeState.Low)]
    [InlineData(70, RangeState.InRange)]
    [InlineData(180, RangeState.InRange)]
    [InlineData(182, RangeState.High)]
    public void ClassifiesAgainstMmolThresholds(int mgDl, RangeState expected) =>
        Assert.Equal(expected, Glucose.Classify(mgDl, 3.9, 10.0));

    [Fact]
    public void StaleAfterFifteenMinutes()
    {
        Assert.False(Glucose.IsStale(new Reading(Now.AddMinutes(-14), 100, "Flat"), Now));
        Assert.True(Glucose.IsStale(new Reading(Now.AddMinutes(-16), 100, "Flat"), Now));
    }

    [Theory]
    [InlineData(0, "just now")]
    [InlineData(3, "3 min ago")]
    [InlineData(59, "59 min ago")]
    [InlineData(60, "1 h ago")]
    [InlineData(26 * 60, "yesterday")]
    [InlineData(3 * 24 * 60, "3 days ago")]
    [InlineData(-2, "just now")]
    public void AgeTextReadsLikeAPerson(int minutesAgo, string expected) =>
        Assert.Equal(expected, Glucose.AgeText(new Reading(Now.AddMinutes(-minutesAgo), 100, "Flat"), Now));
}
