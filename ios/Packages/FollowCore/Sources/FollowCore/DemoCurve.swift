import Foundation

/// Made-up data for "Try the demo" (plan §4, §6): App Review, the Simulator and anyone curious can
/// follow it without a Nightscout site. It is a pure function of time, with no network and no
/// randomness, so the same moment always gives the same value on every phone.
///
/// One reading every five minutes, on the five-minute marks of Unix time. The value is
///
///     mgdl(t) = round(140 + 55 · sin(2π t / 10800) + 18 · sin(2π t / 2700 + 1))
///
/// with `t` in Unix seconds: a slow three-hour wave between about 75 and 215 mg/dL with a smaller
/// 45-minute ripple, so with the default thresholds it passes through low, in range and high. The
/// trend is Nightscout's, from the change per minute since the reading five minutes before. The
/// relay's demo source (`poller/src/live/`) is meant to use the same formula, so the app and the
/// Live Activity agree. No real person's data is in it.
public enum DemoCurve {
    /// What the app stores as the site, and sends to the relay as `nightscoutUrl`, for the demo.
    public static let siteMarker = "demo"
    /// The time between demo readings.
    public static let interval: TimeInterval = 300

    /// The demo value at a moment, in mg/dL.
    public static func mgdl(at unixSeconds: TimeInterval) -> Int {
        let slow = 55 * sin(2 * Double.pi * unixSeconds / 10_800)
        let ripple = 18 * sin(2 * Double.pi * unixSeconds / 2_700 + 1)
        return Int((140 + slow + ripple).rounded(.toNearestOrAwayFromZero))
    }

    /// Nightscout's trend name for a change in mg/dL per minute.
    public static func direction(perMinute rate: Double) -> String {
        if rate <= -3 { return "DoubleDown" }
        if rate <= -2 { return "SingleDown" }
        if rate <= -1 { return "FortyFiveDown" }
        if rate < 1 { return "Flat" }
        if rate < 2 { return "FortyFiveUp" }
        if rate < 3 { return "SingleUp" }
        return "DoubleUp"
    }

    /// The reading on the five-minute mark at or before `date`.
    public static func reading(atOrBefore date: Date) -> Reading {
        let t = (date.timeIntervalSince1970 / interval).rounded(.down) * interval
        let value = mgdl(at: t)
        let rate = Double(value - mgdl(at: t - interval)) / (interval / 60)
        return Reading(at: Date(timeIntervalSince1970: t), mgdl: value, direction: direction(perMinute: rate))
    }

    /// The newest `count` readings at `now`, newest first, like `NightscoutClient.latest`.
    public static func latest(now: Date, count: Int) -> [Reading] {
        let newest = reading(atOrBefore: now)
        return (0..<max(1, count)).map { step in
            reading(atOrBefore: newest.at.addingTimeInterval(-Double(step) * interval))
        }
    }
}
