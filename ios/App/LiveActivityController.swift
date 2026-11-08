import ActivityKit
import Combine
import FollowCore
import Foundation
import os

/// Starts, updates and ends the Live Activity and collects the two push tokens the relay needs
/// (plan §4):
///
/// - the **activity push token**, per activity, which `update` and `end` pushes go to;
/// - the **push-to-start token**, per app install, which starts a new activity with the app closed
///   (the 8-hour restart).
///
/// The tokens go to the relay (`AppModel` → `RelaySync`) whenever they change. Debug builds also
/// write them to `push-tokens.json` in the app group for the push test (ios/README.md).
@MainActor
final class LiveActivityController: ObservableObject {
    @Published private(set) var activityToken: String?
    @Published private(set) var pushToStartToken: String?
    /// When the app started, or first saw, the activity whose token `activityToken` is.
    @Published private(set) var activityStartedAt: Date?
    @Published private(set) var isRunning = false
    @Published private(set) var error: String?

    /// Called whenever a token appears, changes or goes away.
    var onTokensChanged: (() -> Void)?

    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "live-activity")
    private var observed = Set<String>()
    private var observing = false
    private var tokenActivityId: String?
    private static let startedAtKey = "live.startedAt"

    /// Called once at launch. Also picks up activities the relay started by push-to-start while the
    /// app was closed, and their new push tokens.
    func observe() {
        guard !observing else { return }
        observing = true
        for activity in Activity<GlucoseActivityAttributes>.activities { watch(activity) }
        updateRunning()

        Task {
            for await data in Activity<GlucoseActivityAttributes>.pushToStartTokenUpdates {
                let token = data.hexString
                guard token != pushToStartToken else { continue }
                pushToStartToken = token
                logToken("push-to-start", token)
                onTokensChanged?()
            }
        }
        Task {
            for await activity in Activity<GlucoseActivityAttributes>.activityUpdates {
                watch(activity)
            }
        }
    }

    /// The last start or end; each waits for the one before, so a restart and a switch turned off
    /// at the same moment never leave an activity running that should not be.
    private var lastOperation: Task<Void, Never>?

    private func serially(_ work: @escaping () async -> Void) async {
        let previous = lastOperation
        let operation = Task {
            await previous?.value
            await work()
        }
        lastOperation = operation
        await operation.value
    }

    /// Starts an activity with the newest reading, ready to receive pushes. Ends any other first,
    /// so there is only ever one; `stillWanted` is asked again once they have ended.
    func start(current: Reading, previous: Reading?, unit: GlucoseUnit, stillWanted: @escaping () -> Bool) async {
        await serially { [self] in
            await self.endNow()
            guard stillWanted() else { return }
            self.request(current: current, previous: previous, unit: unit)
        }
    }

    private func request(current: Reading, previous: Reading?, unit: GlucoseUnit) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = L("live.error.disabled")
            return
        }
        let state = LiveGlucoseState(current: current, previous: previous)
        do {
            let activity = try Activity.request(
                attributes: GlucoseActivityAttributes(unit: unit),
                content: ActivityContent(state: state, staleDate: state.staleDate),
                pushType: .token
            )
            error = nil
            watch(activity)
        } catch {
            self.error = L("live.error.start")
            logger.error("start failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// While the app is open it updates the activity itself with every reading it reads, so the
    /// app and the lock screen never disagree. Only a newer reading replaces what the activity
    /// shows (`LiveActivitySync`), so a late local fetch never overwrites a newer pushed state.
    func show(current: Reading, previous: Reading?) {
        let fresh = LiveGlucoseState(current: current, previous: previous)
        for activity in Activity<GlucoseActivityAttributes>.activities where Self.isLive(activity) {
            guard LiveActivitySync.shouldReplace(activity.content.state, with: fresh) else { continue }
            Task {
                await activity.update(ActivityContent(state: fresh, staleDate: fresh.staleDate))
            }
        }
    }

    /// Redraws running activities with their current content, so changed colour thresholds show at
    /// once instead of at the next push.
    func redraw() {
        Task {
            for activity in Activity<GlucoseActivityAttributes>.activities where Self.isLive(activity) {
                await activity.update(activity.content)
            }
        }
    }

    /// The unit an activity shows is fixed when it starts.
    var runningUnit: GlucoseUnit? {
        Activity<GlucoseActivityAttributes>.activities.first(where: Self.isLive)?.attributes.unit
    }

    func endAll() async {
        await serially { [self] in await self.endNow() }
    }

    private func endNow() async {
        for activity in Activity<GlucoseActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        isRunning = false
        if activityToken != nil {
            activityToken = nil
            activityStartedAt = nil
            tokenActivityId = nil
            onTokensChanged?()
        }
    }

    private func watch(_ activity: Activity<GlucoseActivityAttributes>) {
        guard !observed.contains(activity.id) else { return }
        observed.insert(activity.id)
        let startedAt = Self.startedAt(activity.id)
        updateRunning()
        Task {
            for await data in activity.pushTokenUpdates {
                let token = data.hexString
                guard token != activityToken else { continue }
                activityToken = token
                activityStartedAt = startedAt
                tokenActivityId = activity.id
                logToken("activity", token)
                onTokensChanged?()
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                observed.remove(activity.id)
                Self.forgetStartedAt(activity.id)
                updateRunning()
                if tokenActivityId == activity.id {
                    activityToken = nil
                    activityStartedAt = nil
                    tokenActivityId = nil
                    onTokensChanged?()
                }
                logger.info("activity \(state == .ended ? "ended" : "dismissed", privacy: .public)")
            }
        }
    }

    /// Still on the lock screen and accepting updates: active, or past its stale date.
    nonisolated private static func isLive(_ activity: Activity<GlucoseActivityAttributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    private func updateRunning() {
        isRunning = Activity<GlucoseActivityAttributes>.activities.contains(where: Self.isLive)
    }

    /// ActivityKit does not say when an activity began, so the app notes when it first saw each one.
    private static func startedAt(_ id: String) -> Date {
        var all = UserDefaults.standard.dictionary(forKey: startedAtKey) as? [String: Double] ?? [:]
        if let seen = all[id] { return Date(timeIntervalSince1970: seen) }
        let now = Date()
        all[id] = now.timeIntervalSince1970
        UserDefaults.standard.set(all, forKey: startedAtKey)
        return now
    }

    private static func forgetStartedAt(_ id: String) {
        var all = UserDefaults.standard.dictionary(forKey: startedAtKey) as? [String: Double] ?? [:]
        all[id] = nil
        UserDefaults.standard.set(all, forKey: startedAtKey)
    }

    /// Push tokens identify the device, so they never go to the unified log: the log says only that
    /// one arrived. Debug builds also write them to `push-tokens.json` in the app group container,
    /// a local file the push test reads on the Mac (`xcrun simctl get_app_container booted
    /// ninja.jepsen.naensom group.ninja.jepsen.naensom`); the debug section in Settings shows them.
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
