import Foundation

/// The Live Activity's content state (plan §4): what every push from the relay carries, and what the
/// lock screen draws. It is the `ContentState` of the app's `ActivityAttributes`, which live in the
/// app target because ActivityKit is iOS-only.
///
/// The JSON shape is the contract with `poller/src/live/` and is pinned by
/// `Tests/FollowCoreTests/Fixtures/content-state.json`, which the Node tests read too:
///
///     { "mgdl": 151, "direction": "FortyFiveUp", "delta": 6, "readingAt": 1793016000 }
///
/// `readingAt` is Unix seconds. ActivityKit decodes a push's `content-state` with a default
/// `JSONDecoder`, whose dates count from 2001; encoding the number ourselves keeps the server and the
/// phone from disagreeing by 31 years. `delta` is mg/dL, null when there is no recent previous
/// reading to compare with.
public struct LiveGlucoseState: Codable, Hashable, Sendable {
    public var mgdl: Int
    public var direction: String
    public var delta: Int?
    public var readingAt: Date

    public init(mgdl: Int, direction: String, delta: Int?, readingAt: Date) {
        self.mgdl = mgdl
        self.direction = direction
        self.delta = delta
        self.readingAt = readingAt
    }

    /// The state for the newest reading, with the change from the one before when it is recent.
    public init(current: Reading, previous: Reading?) {
        self.init(
            mgdl: current.mgdl,
            direction: current.direction,
            delta: Glucose.deltaMgdl(current, previous: previous),
            readingAt: current.at
        )
    }

    public var reading: Reading { Reading(at: readingAt, mgdl: mgdl, direction: direction) }

    /// When the activity should show itself as stale: 15 minutes after the reading.
    public var staleDate: Date { Glucose.staleDate(for: reading) }

    private enum CodingKeys: String, CodingKey {
        case mgdl, direction, delta, readingAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        mgdl = try container.decode(Int.self, forKey: .mgdl)
        direction = try container.decodeIfPresent(String.self, forKey: .direction) ?? ""
        delta = try container.decodeIfPresent(Int.self, forKey: .delta)
        readingAt = Date(timeIntervalSince1970: try container.decode(Double.self, forKey: .readingAt))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mgdl, forKey: .mgdl)
        try container.encode(direction, forKey: .direction)
        try container.encode(delta, forKey: .delta)
        try container.encode(readingAt.timeIntervalSince1970, forKey: .readingAt)
    }
}
