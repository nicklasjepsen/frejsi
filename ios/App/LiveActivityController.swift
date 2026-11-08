import ActivityKit
import Combine
import FollowCore
import Foundation
import os

/// Starts the Live Activity and reports the two push tokens the relay needs (plan §4):
///
/// - the **activity push token**, per activity, which `update` and `end` pushes go to;
/// - the **push-to-start token**, per app install, which starts a new activity with the app closed
///   (the 8-hour restart).
///
/// In stage 2 nothing registers with a server yet: the tokens are logged and shown on screen so the
/// operator can hand them to `pnpm --filter ./poller push-test` (ios/README.md). Stage 4 sends them
/// to `live-register` instead.
@MainActor
final class LiveActivityController: ObservableObject {
    @Published private(set) var activityToken: String?
    @Published private(set) var pushToStartToken: String?
    @Published private(set) var isRunning = false
    @Published private(set) var error: String?

    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "live-activity")
    private var observed = Set<String>()
    private var observing = false

    /// Called once at launch. Also picks up activities the relay started by push-to-start while the
    /// app was closed, and their new push tokens.
    func observe() {
        guard !observing else { return }
        observing = true
        for activity in Activity<GlucoseActivityAttributes>.activities { watch(activity) }

        Task {
            for await data in Activity<GlucoseActivityAttributes>.pushToStartTokenUpdates {
                let token = data.hexString
                pushToStartToken = token
                logToken("push-to-start", token)
            }
        }
        Task {
            for await activity in Activity<GlucoseActivityAttributes>.activityUpdates {
                watch(activity)
            }
        }
    }

    /// Starts an activity with the newest reading, ready to receive pushes.
    func start(current: Reading, previous: Reading?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = "Live Activities are turned off for Nænsom in Settings"
            return
        }
        let state = LiveGlucoseState(current: current, previous: previous)
        do {
            let activity = try Activity.request(
                attributes: GlucoseActivityAttributes.default,
                content: ActivityContent(state: state, staleDate: state.staleDate),
                pushType: .token
            )
            error = nil
            watch(activity)
        } catch {
            self.error = "Couldn't start the Live Activity"
            logger.error("start failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Redraws running activities with their current content, so changed colour thresholds show at
    /// once instead of at the next push.
    func redraw() {
        Task {
            for activity in Activity<GlucoseActivityAttributes>.activities where activity.activityState == .active {
                await activity.update(activity.content)
            }
        }
    }

    func endAll() {
        Task {
            for activity in Activity<GlucoseActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            isRunning = false
            activityToken = nil
        }
    }

    private func watch(_ activity: Activity<GlucoseActivityAttributes>) {
        guard !observed.contains(activity.id) else { return }
        observed.insert(activity.id)
        isRunning = true
        Task {
            for await data in activity.pushTokenUpdates {
                let token = data.hexString
                activityToken = token
                logToken("activity", token)
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                observed.remove(activity.id)
                isRunning = !Activity<GlucoseActivityAttributes>.activities.filter { $0.activityState == .active }.isEmpty
                logger.info("activity \(state == .ended ? "ended" : "dismissed", privacy: .public)")
            }
        }
    }

    /// Push tokens are only useful with our APNs key, but they are still identifiers: shown in full
    /// in debug builds (the Simulator test reads them from the log), redacted in release builds.
    private func logToken(_ kind: String, _ token: String) {
        #if DEBUG
        logger.notice("\(kind, privacy: .public) push token: \(token, privacy: .public)")
        #else
        logger.notice("\(kind, privacy: .public) push token: \(token, privacy: .private)")
        #endif
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
