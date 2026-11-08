import Foundation

/// Decisions about the running Live Activity that do not need ActivityKit.
public enum LiveActivitySync {
    /// Whether a reading the app fetched should replace what the activity shows. While the app is
    /// open it updates the activity itself, so the two never disagree; but only with a newer
    /// reading, so a late local fetch never overwrites a newer state the relay pushed.
    public static func shouldReplace(_ shown: LiveGlucoseState?, with fresh: LiveGlucoseState) -> Bool {
        guard let shown else { return true }
        return fresh.readingAt > shown.readingAt
    }

    public enum Status: Equatable, Sendable {
        /// The user turned the Live Activity off.
        case off
        case running
        /// Wanted but not running: it ended (8 hours, the user swiped it away, push-to-start failed).
        /// The main screen says "Live Activity stopped, tap to restart" (plan §4).
        case stopped
    }

    public static func status(wanted: Bool, running: Bool) -> Status {
        if !wanted { return .off }
        return running ? .running : .stopped
    }

    /// A Live Activity on the phone that is still showing (active or stale).
    public struct RunningActivity: Equatable, Sendable {
        public var id: String
        /// When the app started or first saw it.
        public var startedAt: Date

        public init(id: String, startedAt: Date) {
            self.id = id
            self.startedAt = startedAt
        }
    }

    public enum AutoStart: Equatable, Sendable {
        /// Start a new activity with the newest reading.
        case start
        /// One is already running: keep it (the newest) and end any others, never a duplicate.
        case reuse(keep: String, end: [String])
        case nothing
    }

    /// What to do when the app launches or comes back to the foreground. With the Live Activity
    /// switched off nothing happens; a running one is reused (the newest kept, the rest ended);
    /// otherwise a new one starts when "Start Live Activity automatically" is on, iOS allows Live
    /// Activities and there is a reading to show.
    public static func autoStart(
        autoStartOn: Bool, liveActivityOn: Bool, systemAllows: Bool, running: [RunningActivity], haveReading: Bool
    ) -> AutoStart {
        guard liveActivityOn else { return .nothing }
        if let newest = running.max(by: { ($0.startedAt, $0.id) < ($1.startedAt, $1.id) }) {
            let others = running.filter { $0.id != newest.id }.map(\.id).sorted()
            return .reuse(keep: newest.id, end: others)
        }
        guard autoStartOn, systemAllows, haveReading else { return .nothing }
        return .start
    }
}
