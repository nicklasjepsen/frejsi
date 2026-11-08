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
}
