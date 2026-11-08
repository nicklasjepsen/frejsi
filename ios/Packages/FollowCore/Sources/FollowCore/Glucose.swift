import Foundation

public enum GlucoseUnit: String, Codable, Sendable, CaseIterable {
    case mmolL
    case mgdL

    public var label: String {
        switch self {
        case .mmolL: return "mmol/L"
        case .mgdL: return "mg/dL"
        }
    }
}

public enum RangeState: String, Codable, Sendable {
    case low
    case inRange
    case high
}

/// The language of the few words FollowCore formats itself (ages). The app follows the phone's
/// language; anything that is not Danish is English.
public enum Language: String, Sendable {
    case da
    case en

    public init(localeIdentifier: String) {
        self = localeIdentifier.lowercased().hasPrefix("da") ? .da : .en
    }

    /// The app's language from the phone's preferred languages (`Locale.preferredLanguages`): the
    /// first one the app speaks, English when it speaks none of them. The app and the Live Activity
    /// extension both call this, so the lock screen and the app always agree.
    public static func preferred(_ preferredLanguages: [String]) -> Language {
        for identifier in preferredLanguages {
            let code = identifier.lowercased()
            if code.hasPrefix("da") { return .da }
            if code.hasPrefix("en") { return .en }
        }
        return .en
    }

    /// The locale for everything the app formats or lets iOS format: numbers and ticking ages.
    public var localeIdentifier: String {
        switch self {
        case .da: return "da_DK"
        case .en: return "en_GB"
        }
    }

    /// Follows iOS's ticking relative time ("1 min, 25 sec") on the lock screen.
    public var agoSuffix: String {
        switch self {
        case .da: return "siden"
        case .en: return "ago"
        }
    }
}

/// One sensor reading as Nightscout reports it: mg/dL, its time and the trend name.
public struct Reading: Codable, Equatable, Hashable, Sendable {
    public var at: Date
    public var mgdl: Int
    /// Nightscout's trend name ("Flat", "FortyFiveUp", …), or "" when the site sent none.
    public var direction: String

    public init(at: Date, mgdl: Int, direction: String) {
        self.at = at
        self.mgdl = mgdl
        self.direction = direction
    }

    public var mmolL: Double { Glucose.toMmolL(mgdl) }
}

/// Units, arrows, ranges, ages and staleness. Ported from `desktop/src/BgTray.Core/Glucose.cs`,
/// with the same test cases, so the tray app and the phone agree on every value they show.
public enum Glucose {
    /// The clinical factor meters use; 1 mmol/L is 18.0182 mg/dL.
    public static let mgdlPerMmolL = 18.0

    /// A reading older than this is stale: the value goes grey and the age says how old it is.
    public static let staleAfter: TimeInterval = 15 * 60

    /// Two readings further apart than this have no meaningful change between them.
    public static let maxDeltaGap: TimeInterval = 12 * 60

    public static func toMmolL(_ mgdl: Int) -> Double {
        (Double(mgdl) / mgdlPerMmolL * 10).rounded(.toNearestOrAwayFromZero) / 10
    }

    public static func toMgdl(_ mmolL: Double) -> Int {
        Int((mmolL * mgdlPerMmolL).rounded(.toNearestOrAwayFromZero))
    }

    /// The value in the chosen unit: one decimal for mmol/L, none for mg/dL, with the locale's
    /// decimal separator ("8,4" in Danish, "8.4" in English).
    public static func format(_ mgdl: Int, unit: GlucoseUnit, locale: Locale = .current) -> String {
        switch unit {
        case .mmolL: return oneDecimal(toMmolL(mgdl), locale: locale)
        case .mgdL: return String(mgdl)
        }
    }

    /// The signed change since the previous reading in the chosen unit, with a real minus sign;
    /// nil without a previous reading, or when the two are more than 12 minutes apart.
    public static func formatDelta(
        _ current: Reading, previous: Reading?, unit: GlucoseUnit, locale: Locale = .current
    ) -> String? {
        guard let previous else { return nil }
        let gap = current.at.timeIntervalSince(previous.at)
        guard gap >= 0, gap <= maxDeltaGap else { return nil }
        switch unit {
        case .mmolL:
            let delta = ((current.mmolL - previous.mmolL) * 10).rounded(.toNearestOrAwayFromZero) / 10
            return (delta >= 0 ? "+" : "−") + oneDecimal(abs(delta), locale: locale)
        case .mgdL:
            let delta = current.mgdl - previous.mgdl
            return (delta >= 0 ? "+" : "−") + String(abs(delta))
        }
    }

    /// The change a Live Activity carries (`LiveGlucoseState.delta`, mg/dL) in the chosen unit,
    /// formatted like `formatDelta`: the mmol/L change is the difference of the two rounded values.
    public static func formatDelta(mgdl: Int, deltaMgdl: Int, unit: GlucoseUnit, locale: Locale = .current) -> String {
        let at = Date(timeIntervalSince1970: 0)
        let current = Reading(at: at, mgdl: mgdl, direction: "")
        let previous = Reading(at: at, mgdl: mgdl - deltaMgdl, direction: "")
        return formatDelta(current, previous: previous, unit: unit, locale: locale)!
    }

    /// The change in mg/dL, for the Live Activity's content state; nil on the same terms as
    /// `formatDelta`.
    public static func deltaMgdl(_ current: Reading, previous: Reading?) -> Int? {
        guard let previous else { return nil }
        let gap = current.at.timeIntervalSince(previous.at)
        guard gap >= 0, gap <= maxDeltaGap else { return nil }
        return current.mgdl - previous.mgdl
    }

    /// Nightscout's trend names as arrows. Unknown or non-computable trends are "", never a guess.
    public static func arrow(_ direction: String?) -> String {
        switch direction {
        case "DoubleUp": return "⇈"
        case "SingleUp": return "↑"
        case "FortyFiveUp": return "↗"
        case "Flat": return "→"
        case "FortyFiveDown": return "↘"
        case "SingleDown": return "↓"
        case "DoubleDown": return "⇊"
        default: return ""
        }
    }

    /// Low below the low threshold, high above the high one, both in mmol/L as the app stores them.
    /// The thresholds colour the value; nothing else.
    public static func classify(_ mgdl: Int, lowMmolL: Double, highMmolL: Double) -> RangeState {
        let mmol = toMmolL(mgdl)
        if mmol < lowMmolL { return .low }
        if mmol > highMmolL { return .high }
        return .inRange
    }

    public static func isStale(_ reading: Reading, now: Date) -> Bool {
        now.timeIntervalSince(reading.at) > staleAfter
    }

    /// When the reading turns stale: the Live Activity's `staleDate`.
    public static func staleDate(for reading: Reading) -> Date {
        reading.at.addingTimeInterval(staleAfter)
    }

    /// "just now", "3 min ago", "2 h ago", "yesterday", "3 days ago" (Danish: "lige nu",
    /// "3 min siden", …). A reading from the future is "just now".
    public static func ageText(_ reading: Reading, now: Date, language: Language = .en) -> String {
        let age = now.timeIntervalSince(reading.at)
        let minutes = Int(age / 60)
        let hours = Int(age / 3600)
        let days = Int(age / 86400)
        switch language {
        case .en:
            if age < 60 { return "just now" }
            if age < 3600 { return "\(minutes) min ago" }
            if age < 86400 { return "\(hours) h ago" }
            if age < 2 * 86400 { return "yesterday" }
            return "\(days) days ago"
        case .da:
            if age < 60 { return "lige nu" }
            if age < 3600 { return "\(minutes) min siden" }
            if age < 86400 { return "\(hours) t siden" }
            if age < 2 * 86400 { return "i går" }
            return "\(days) dage siden"
        }
    }

    private static func oneDecimal(_ value: Double, locale: Locale) -> String {
        let text = String(format: "%.1f", value)
        let separator = locale.decimalSeparator ?? "."
        return separator == "." ? text : text.replacingOccurrences(of: ".", with: separator)
    }
}
