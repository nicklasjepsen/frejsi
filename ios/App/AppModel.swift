import Combine
import FollowCore
import Foundation

/// Ties the pieces together: what the app follows (`FollowModel`), the Live Activity
/// (`LiveActivityController`), the relay registration (`RelaySync`) and the reminders
/// (`NotificationController`). The screens call these actions; the pieces never call each other.
@MainActor
final class AppModel: ObservableObject {
    let follow = FollowModel()
    let live = LiveActivityController()
    let relay = RelaySync()
    let notifications = NotificationController.shared

    /// A follow link that arrived while the phone is not set up; onboarding picks it up.
    @Published var pendingLink: FollowLink?
    /// A follow link for another site that arrived while the phone follows one; the screen asks first.
    @Published var replacementLink: FollowLink?
    /// True from onboarding until the first activity has been started, so the main screen does not
    /// say "stopped" while it is starting.
    @Published private(set) var startingActivity = false

    private var launched = false
    private var syncTask: Task<Void, Never>?

    /// Once, when the first window appears.
    func launch() {
        guard !launched else { return }
        launched = true
        live.onTokensChanged = { [weak self] in self?.scheduleSync() }
        notifications.onDeviceToken = { [weak self] in self?.scheduleSync() }
        follow.onNewReading = { [weak self] current, previous in
            self?.newReading(current, previous)
        }
        follow.onThresholdsChanged = { [weak self] in
            self?.live.redraw()
            WidgetSync.reload()
            self?.scheduleSync()
        }
        live.observe()
        // A removal the relay has not confirmed yet is tried again, followed site or not.
        PendingUnregisterSync.shared.retryIfDue()
        // An address and token saved before the widgets existed move to the shared access group.
        KeychainStore.shareWithExtension()
        if follow.settings.alertsOn {
            Task { await notifications.registerIfAllowed() }
        }
        syncNow(force: true)
        if follow.source != nil {
            Task {
                await follow.refresh()
                await autoStartIfWanted()
            }
        }
    }

    /// The app came to the foreground: read now, start or reuse the Live Activity, and tell the
    /// relay the phone is still here.
    func becameActive() {
        PendingUnregisterSync.shared.retryIfDue()
        guard follow.source != nil else { return }
        Task {
            await follow.refresh()
            await autoStartIfWanted()
        }
        syncNow(force: false)
    }

    /// With the Live Activity on, at launch and on every return to the foreground: reuse a running
    /// activity (the newest; others end) or start one. A new activity's push token reaches the
    /// relay through `onTokensChanged`.
    func autoStartIfWanted() async {
        guard follow.source != nil else { return }
        let decision = LiveActivitySync.autoStart(
            liveActivityOn: follow.settings.liveActivityOn,
            systemAllows: live.systemAllows,
            running: live.running(),
            haveReading: follow.latest != nil
        )
        switch decision {
        case .start:
            await startActivity()
        case .reuse(let keep, let others):
            await live.keep(keep, ending: others)
        case .nothing:
            break
        }
    }

    // MARK: - Onboarding and links

    func open(_ url: URL) {
        guard let link = FollowLink.parse(url) else { return }
        guard let source = follow.source else {
            pendingLink = link
            return
        }
        if source == .nightscout(site: link.site, token: link.token) { return }
        replacementLink = link
    }

    /// Onboarding is done: follow the source, read the history, start the Live Activity (on by
    /// default) and register with the relay.
    func finishOnboarding(_ source: FollowSource) {
        pendingLink = nil
        follow.follow(source)
        startingActivity = follow.settings.liveActivityOn
        Task {
            await follow.refresh()
            if follow.settings.liveActivityOn { await startActivity() }
            startingActivity = false
            syncNow(force: true)
        }
    }

    /// Follow a link for another site: remove this phone's registration, then onboard with the link.
    func replace(with link: FollowLink) async {
        replacementLink = nil
        _ = await remove(localOnly: false, fallBackToLocal: true)
        pendingLink = link
    }

    // MARK: - Live Activity

    func startActivity() async {
        guard let latest = follow.latest else { return }
        await live.start(current: latest, previous: follow.previous, unit: follow.settings.unit) { [weak self] in
            guard let self else { return false }
            return self.follow.source != nil && self.follow.settings.liveActivityOn
        }
    }

    func setLiveActivity(_ on: Bool) {
        follow.update { $0.liveActivityOn = on }
        Task {
            if on {
                await startActivity()
            } else {
                await live.endAll()
            }
            scheduleSync()
        }
    }

    /// A newer reading: to the Live Activity and to the widgets, so neither shows less than the app.
    private func newReading(_ current: Reading, _ previous: Reading?) {
        live.show(current: current, previous: previous)
        if let source = follow.source {
            WidgetSync.publish(current: current, previous: previous, source: source)
        }
    }

    // MARK: - Settings

    func setUnit(_ unit: GlucoseUnit) {
        guard unit != follow.settings.unit else { return }
        follow.update { $0.unit = unit }
        WidgetSync.reload()
        // An activity's unit is fixed when it starts: start it again in the new unit.
        if live.isRunning, live.runningUnit != unit {
            Task { await startActivity() }
        }
        scheduleSync()
    }

    func setCurveWindow(_ window: CurveWindow) {
        follow.update { $0.curveWindow = window }
    }

    func step(_ kind: GlucoseThresholds.Kind, by steps: Int) {
        follow.step(kind, by: steps)
        live.redraw()
        WidgetSync.reload()
        scheduleSync()
    }

    func resetThresholds() {
        follow.resetThresholds()
        live.redraw()
        WidgetSync.reload()
        scheduleSync()
    }

    /// Reminders on asks for notification permission first; without it the switch stays off.
    func setAlerts(_ on: Bool) {
        guard on else {
            follow.update { $0.alertsOn = false }
            scheduleSync()
            return
        }
        Task {
            let allowed = await notifications.requestPermission()
            follow.update { $0.alertsOn = allowed }
            scheduleSync()
        }
    }

    // MARK: - Remove this phone

    /// Ends the activities, deletes the relay's copy and clears the phone, back to onboarding.
    /// Answers false, and changes nothing, when the relay cannot be reached and `localOnly` and
    /// `fallBackToLocal` are false; the screen then offers to remove it from this phone only. A
    /// removal from the phone only leaves the relay's deletion pending (`PendingUnregisterSync`).
    @discardableResult
    func remove(localOnly: Bool, fallBackToLocal: Bool = false) async -> Bool {
        syncTask?.cancel()
        if localOnly {
            await relay.forget()
        } else {
            do {
                try await relay.remove()
            } catch {
                guard fallBackToLocal else { return false }
                await relay.forget()
            }
        }
        await live.endAll()
        notifications.reset()
        follow.forget()
        return true
    }

    // MARK: - Relay

    /// Settings and tokens often change several at a time (two tokens, a stepper held down):
    /// wait a moment and send one registration.
    func scheduleSync() {
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            syncNow(force: true)
        }
    }

    private func syncNow(force: Bool) {
        guard let source = follow.source else { return }
        let tokens = LivePushTokens(
            pushToStart: live.pushToStartToken,
            activity: live.activityToken,
            activityStartedAt: live.activityStartedAt,
            device: notifications.deviceToken
        )
        let registration = RelayRegistration.make(
            source: source,
            settings: follow.settings,
            thresholds: follow.thresholds,
            tokens: tokens,
            language: AppLanguage.current,
            environment: RelaySync.environment
        )
        relay.sync(registration, force: force)
    }
}
