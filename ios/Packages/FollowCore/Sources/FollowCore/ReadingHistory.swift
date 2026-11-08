import Foundation

/// How much of the curve the main screen shows.
public enum CurveWindow: Int, Codable, CaseIterable, Sendable {
    case threeHours = 3
    case sixHours = 6
    case twelveHours = 12

    public var hours: Int { rawValue }
    public var duration: TimeInterval { TimeInterval(rawValue) * 3600 }
}

/// The readings the app keeps while it is open: the last 12 hours, newest first, one per
/// timestamp. Fetched in full once, then topped up with the few readings since the newest.
public enum ReadingHistory {
    /// The longest curve the app shows.
    public static let keep: TimeInterval = CurveWindow.twelveHours.duration
    /// Twelve hours of five-minute readings and a little more for a site that uploads more often.
    public static let fullFetchCount = 150

    /// How many readings to ask for: the full history when there is none, otherwise enough to
    /// cover the gap since the newest one (one every five minutes) and a little more.
    public static func fetchCount(newest: Reading?, now: Date) -> Int {
        guard let newest else { return fullFetchCount }
        let gap = max(0, now.timeIntervalSince(newest.at))
        if gap >= keep { return fullFetchCount }
        return min(fullFetchCount, Int(gap / 300) + 3)
    }

    /// Old and new together, newest first, one per timestamp (the fresh copy wins), older than
    /// twelve hours dropped, except the newest reading: a site that has sent nothing for longer
    /// still shows its last value, grey and with its age.
    public static func merge(_ existing: [Reading], _ fresh: [Reading], now: Date) -> [Reading] {
        var byTime: [Date: Reading] = [:]
        for reading in existing { byTime[reading.at] = reading }
        for reading in fresh { byTime[reading.at] = reading }
        let sorted = byTime.values.sorted { $0.at > $1.at }
        let oldest = now.addingTimeInterval(-keep)
        return sorted.enumerated().filter { $0.offset == 0 || $0.element.at >= oldest }.map(\.element)
    }

    /// The readings a curve window shows, oldest first, as a chart draws them.
    public static func points(_ readings: [Reading], window: CurveWindow, now: Date) -> [Reading] {
        let start = now.addingTimeInterval(-window.duration)
        return readings.filter { $0.at >= start && $0.at <= now }.sorted { $0.at < $1.at }
    }

    /// The curve's vertical range in mg/dL: the readings and the target range, with a little room,
    /// on 20 mg/dL steps so the axis does not jump with every reading.
    public static func yDomainMgdl(_ readings: [Reading], thresholds: GlucoseThresholds) -> ClosedRange<Int> {
        let values = readings.map(\.mgdl)
        let low = min(values.min() ?? thresholds.lowMgdl, thresholds.lowMgdl) - 10
        let high = max(values.max() ?? thresholds.highMgdl, thresholds.highMgdl) + 10
        let bottom = max(0, Int((Double(low) / 20).rounded(.down)) * 20)
        let top = min(GlucoseThresholds.maxMgdl + 30, Int((Double(high) / 20).rounded(.up)) * 20)
        return bottom...max(top, bottom + 40)
    }
}

/// When the app reads again while it is on screen (plan §3): nothing until the next reading is
/// due (the newest + 5 minutes), then every 30 seconds until it arrives.
public enum RefreshSchedule {
    public static let expectedInterval: TimeInterval = 300
    public static let pollInterval: TimeInterval = 30

    public static func delay(newest: Reading?, now: Date) -> TimeInterval {
        guard let newest else { return pollInterval }
        let untilDue = newest.at.addingTimeInterval(expectedInterval).timeIntervalSince(now)
        return min(expectedInterval, max(pollInterval, untilDue))
    }
}
