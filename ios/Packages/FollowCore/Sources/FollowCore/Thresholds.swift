import Foundation

/// The four values that colour a reading (owner, 2026-11-08): green inside the target range, yellow
/// between a target edge and its urgent value, red at or beyond an urgent value, grey when stale.
/// Colours only: they raise no alarm, and the value, arrow and age are always shown with them.
///
/// Stored in mg/dL, the unit Nightscout's API uses, so a threshold never drifts by rounding when the
/// unit changes. The defaults are Nightscout's own (`bgLow`, `bgTargetBottom`, `bgTargetTop`,
/// `bgHigh`): 55, 80, 180 and 260 mg/dL.
public struct GlucoseThresholds: Codable, Equatable, Hashable, Sendable {
    public var urgentLowMgdl: Int
    public var lowMgdl: Int
    public var highMgdl: Int
    public var urgentHighMgdl: Int

    public static let nightscoutDefaults = GlucoseThresholds(urgentLowMgdl: 55, lowMgdl: 80, highMgdl: 180, urgentHighMgdl: 260)

    /// The bounds a threshold may take, and the smallest gap between neighbours.
    public static let minMgdl = 36
    public static let maxMgdl = 450
    public static let minGapMgdl = 1

    public init(urgentLowMgdl: Int, lowMgdl: Int, highMgdl: Int, urgentHighMgdl: Int) {
        self.urgentLowMgdl = urgentLowMgdl
        self.lowMgdl = lowMgdl
        self.highMgdl = highMgdl
        self.urgentHighMgdl = urgentHighMgdl
    }

    /// Strictly increasing and inside the bounds.
    public var isValid: Bool {
        Self.minMgdl <= urgentLowMgdl
            && urgentLowMgdl < lowMgdl
            && lowMgdl < highMgdl
            && highMgdl < urgentHighMgdl
            && urgentHighMgdl <= Self.maxMgdl
    }

    public enum Kind: String, CaseIterable, Codable, Sendable {
        case urgentLow, low, high, urgentHigh
    }

    public subscript(kind: Kind) -> Int {
        get {
            switch kind {
            case .urgentLow: return urgentLowMgdl
            case .low: return lowMgdl
            case .high: return highMgdl
            case .urgentHigh: return urgentHighMgdl
            }
        }
        set {
            switch kind {
            case .urgentLow: urgentLowMgdl = newValue
            case .low: lowMgdl = newValue
            case .high: highMgdl = newValue
            case .urgentHigh: urgentHighMgdl = newValue
            }
        }
    }

    /// The range one threshold may move in without crossing its neighbours, in mg/dL.
    public func allowedRange(for kind: Kind) -> ClosedRange<Int> {
        switch kind {
        case .urgentLow: return Self.minMgdl...(lowMgdl - Self.minGapMgdl)
        case .low: return (urgentLowMgdl + Self.minGapMgdl)...(highMgdl - Self.minGapMgdl)
        case .high: return (lowMgdl + Self.minGapMgdl)...(urgentHighMgdl - Self.minGapMgdl)
        case .urgentHigh: return (highMgdl + Self.minGapMgdl)...Self.maxMgdl
        }
    }

    /// One stepper step in the shown unit: 0.1 mmol/L or 1 mg/dL. The new value is clamped
    /// between its neighbours, so the four always stay in order.
    public func stepped(_ kind: Kind, by steps: Int, unit: GlucoseUnit) -> GlucoseThresholds {
        var next = self
        let current = self[kind]
        let target: Int
        switch unit {
        case .mgdL:
            target = current + steps
        case .mmolL:
            // Step from the value as shown, so 4.4 goes to 4.5 and never sticks on a rounding edge.
            let shown = Glucose.toMmolL(current)
            target = Glucose.toMgdl(((shown * 10).rounded() + Double(steps)) / 10)
        }
        let range = allowedRange(for: kind)
        next[kind] = min(max(target, range.lowerBound), range.upperBound)
        return next
    }

    /// The value in the shown unit, formatted like a reading ("4,4" / "80").
    public func formatted(_ kind: Kind, unit: GlucoseUnit, locale: Locale = .current) -> String {
        Glucose.format(self[kind], unit: unit, locale: locale)
    }

    /// The thresholds from Nightscout's `GET /api/v1/status.json` (`settings.thresholds`), or nil
    /// when the site does not send all four or they are out of order. Nightscout keeps them in mg/dL;
    /// a site configured with mmol/L values (all four under 40) is converted.
    public static func fromNightscoutStatus(_ data: Data) -> GlucoseThresholds? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let settings = root["settings"] as? [String: Any],
              let thresholds = settings["thresholds"] as? [String: Any]
        else { return nil }
        func value(_ key: String) -> Double? {
            if thresholds[key] is Bool { return nil }
            if let d = thresholds[key] as? Double { return d }
            if let i = thresholds[key] as? Int { return Double(i) }
            if let n = thresholds[key] as? NSNumber { return n.doubleValue }
            return nil
        }
        guard let bgLow = value("bgLow"), let bottom = value("bgTargetBottom"),
              let top = value("bgTargetTop"), let bgHigh = value("bgHigh"),
              [bgLow, bottom, top, bgHigh].allSatisfy({ $0.isFinite && $0 > 0 && $0 < 1000 })
        else { return nil }
        let mmol = [bgLow, bottom, top, bgHigh].allSatisfy { $0 < 40 }
        func mgdl(_ v: Double) -> Int { mmol ? Glucose.toMgdl(v) : Int(v.rounded()) }
        let result = GlucoseThresholds(urgentLowMgdl: mgdl(bgLow), lowMgdl: mgdl(bottom), highMgdl: mgdl(top), urgentHighMgdl: mgdl(bgHigh))
        return result.isValid ? result : nil
    }
}

/// Where a value sits against the thresholds.
public enum GlucoseBand: String, Codable, Sendable {
    case urgentLow, low, inRange, high, urgentHigh
}

/// The colour a value is drawn in. `stale` (grey) wins over every band.
public enum GlucoseColor: String, Codable, Sendable {
    case green, yellow, red, stale
}

extension Glucose {
    /// Red at or beyond an urgent value, yellow between it and the target edge, green from low to
    /// high inclusive.
    public static func band(_ mgdl: Int, thresholds: GlucoseThresholds) -> GlucoseBand {
        if mgdl <= thresholds.urgentLowMgdl { return .urgentLow }
        if mgdl < thresholds.lowMgdl { return .low }
        if mgdl <= thresholds.highMgdl { return .inRange }
        if mgdl < thresholds.urgentHighMgdl { return .high }
        return .urgentHigh
    }

    public static func color(_ mgdl: Int, thresholds: GlucoseThresholds, isStale: Bool) -> GlucoseColor {
        if isStale { return .stale }
        switch band(mgdl, thresholds: thresholds) {
        case .urgentLow, .urgentHigh: return .red
        case .low, .high: return .yellow
        case .inRange: return .green
        }
    }

    /// The colour of a reading now: grey once it is more than 15 minutes old.
    public static func color(_ reading: Reading, thresholds: GlucoseThresholds, now: Date) -> GlucoseColor {
        color(reading.mgdl, thresholds: thresholds, isStale: isStale(reading, now: now))
    }
}
