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
/// In stage 2 nothing registers with a server yet: the tokens are shown on screen (and written locally in debug builds) so the
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
            error = AppLanguage.say("Live Activities are turned off for Nænsom in Settings", "Live Activities er slået fra for Nænsom i Indstillinger")
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
            self.error = AppLanguage.say("Couldn't start the Live Activity", "Live Activity kunne ikke starte")
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

    /// Push tokens identify the device, so they never go to the unified log: the log says only that
    /// one arrived. Debug builds also write them to `push-tokens.json` in the app group container,
    /// a local file the push test reads on the Mac (`xcrun simctl get_app_container booted
    /// ninja.jepsen.naensom group.ninja.jepsen.naensom`); the screen shows them with Copy.
    private func logToken(_ kind: String, _ token: String) {
        logger.notice("\(kind, privacy: .public) push token received")
        #if DEBUG
        guard let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ThresholdStore.appGroup) else { return }
        let file = folder.appendingPathComponent("push-tokens.json")
        var tokens = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: file))) ?? [:]
        tokens[kind] = token
        if let data = try? JSONEncoder().encode(tokens) {
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        #endif
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
