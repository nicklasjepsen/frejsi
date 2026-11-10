import Foundation

/// The user's choices, kept as JSON in the app group. Anything missing or unreadable falls back to
/// its default, so an older or damaged copy never stops the app from starting.
public struct FollowSettings: Codable, Equatable, Sendable {
    /// mmol/L unless the user picks mg/dL.
    public var unit: GlucoseUnit
    /// On by default after onboarding (plan §3). On means one is always showing: the app starts one
    /// at launch and on every return to the foreground when none is running.
    public var liveActivityOn: Bool
    /// Off until the user turns it on and allows notifications.
    public var alertsOn: Bool
    public var curveWindow: CurveWindow

    public static let defaults = FollowSettings(unit: .mmolL, liveActivityOn: true, alertsOn: false, curveWindow: .sixHours)

    public init(
        unit: GlucoseUnit, liveActivityOn: Bool, alertsOn: Bool, curveWindow: CurveWindow
    ) {
        self.unit = unit
        self.liveActivityOn = liveActivityOn
        self.alertsOn = alertsOn
        self.curveWindow = curveWindow
    }

    /// A copy saved by an earlier build may still hold `autoStartLiveActivity`; it is ignored.
    private enum CodingKeys: String, CodingKey {
        case unit, liveActivityOn, alertsOn, curveWindow
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = Self.defaults
        unit = (try? container.decodeIfPresent(GlucoseUnit.self, forKey: .unit)) ?? fallback.unit
        liveActivityOn = (try? container.decodeIfPresent(Bool.self, forKey: .liveActivityOn)) ?? fallback.liveActivityOn
        alertsOn = (try? container.decodeIfPresent(Bool.self, forKey: .alertsOn)) ?? fallback.alertsOn
        curveWindow = (try? container.decodeIfPresent(CurveWindow.self, forKey: .curveWindow)) ?? fallback.curveWindow
    }

    /// The stored copy, or the defaults when there is none or it cannot be read.
    public static func load(_ data: Data?) -> FollowSettings {
        guard let data, let settings = try? JSONDecoder().decode(FollowSettings.self, from: data) else { return defaults }
        return settings
    }

    public func encoded() -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(self)) ?? Data()
    }
}
