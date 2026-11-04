using System.Globalization;

namespace BgTray.Core;

public enum GlucoseUnit
{
    MmolL,
    MgDl,
}

public enum RangeState
{
    Low,
    InRange,
    High,
}

/// <summary>One sensor reading as Nightscout reports it: mg/dL, its time and the trend name.</summary>
public sealed record Reading(DateTimeOffset At, int MgDl, string Direction)
{
    public double MmolL => Glucose.ToMmolL(MgDl);
}

public static class Glucose
{
    /// <summary>1 mmol/L of glucose is 18.0182 mg/dL; the usual clinical factor of 18 is what meters use.</summary>
    public const double MgDlPerMmolL = 18.0;

    /// <summary>A reading older than this is stale: the value stays on screen with its age, the tray stops showing it.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(15);

    public static double ToMmolL(int mgDl) => Math.Round(mgDl / MgDlPerMmolL, 1);

    public static int ToMgDl(double mmolL) => (int)Math.Round(mmolL * MgDlPerMmolL);

    /// <summary>The value in the chosen unit, one decimal for mmol/L and none for mg/dL, with the culture's separator.</summary>
    public static string Format(int mgDl, GlucoseUnit unit, CultureInfo? culture = null)
    {
        culture ??= CultureInfo.CurrentCulture;
        return unit == GlucoseUnit.MmolL
            ? ToMmolL(mgDl).ToString("0.0", culture)
            : mgDl.ToString(culture);
    }

    public static string UnitLabel(GlucoseUnit unit) => unit == GlucoseUnit.MmolL ? "mmol/L" : "mg/dL";

    /// <summary>The change since the previous reading, signed, in the chosen unit; null without a previous reading close enough to compare.</summary>
    public static string? FormatDelta(Reading current, Reading? previous, GlucoseUnit unit, CultureInfo? culture = null)
    {
        if (previous is null) return null;
        var gap = current.At - previous.At;
        if (gap < TimeSpan.Zero || gap > TimeSpan.FromMinutes(12)) return null;
        culture ??= CultureInfo.CurrentCulture;
        if (unit == GlucoseUnit.MmolL)
        {
            var delta = Math.Round(current.MmolL - previous.MmolL, 1);
            return (delta >= 0 ? "+" : "−") + Math.Abs(delta).ToString("0.0", culture);
        }
        var d = current.MgDl - previous.MgDl;
        return (d >= 0 ? "+" : "−") + Math.Abs(d).ToString(culture);
    }

    /// <summary>Nightscout's trend names as arrows. Unknown or non-computable trends are an empty string, never a guess.</summary>
    public static string Arrow(string? direction) => direction switch
    {
        "DoubleUp" => "⇈",
        "SingleUp" => "↑",
        "FortyFiveUp" => "↗",
        "Flat" => "→",
        "FortyFiveDown" => "↘",
        "SingleDown" => "↓",
        "DoubleDown" => "⇊",
        _ => "",
    };

    /// <summary>Low below the low threshold, high above the high one, both given in mmol/L as the app stores them.</summary>
    public static RangeState Classify(int mgDl, double lowMmolL, double highMmolL)
    {
        var mmol = ToMmolL(mgDl);
        if (mmol < lowMmolL) return RangeState.Low;
        if (mmol > highMmolL) return RangeState.High;
        return RangeState.InRange;
    }

    public static bool IsStale(Reading reading, DateTimeOffset now) => now - reading.At > StaleAfter;

    /// <summary>"just now", "3 min ago", "2 h ago", "yesterday"; a reading from the future is "just now".</summary>
    public static string AgeText(Reading reading, DateTimeOffset now)
    {
        var age = now - reading.At;
        if (age < TimeSpan.FromMinutes(1)) return "just now";
        if (age < TimeSpan.FromHours(1)) return $"{(int)age.TotalMinutes} min ago";
        if (age < TimeSpan.FromHours(24)) return $"{(int)age.TotalHours} h ago";
        if (age < TimeSpan.FromHours(48)) return "yesterday";
        return $"{(int)age.TotalDays} days ago";
    }
}
