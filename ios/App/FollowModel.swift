import Combine
import FollowCore
import Foundation

/// What the app follows and what it has read. In the foreground it reads Nightscout (or the demo
/// curve) around the expected next reading; nothing here keeps the lock screen current with the
/// app closed: that is the relay's pushes (plan §0).
@MainActor
final class FollowModel: ObservableObject {
    @Published private(set) var source: FollowSource? = FollowSourceStore.load()
    /// The last 12 hours, newest first.
    @Published private(set) var readings: [Reading] = []
    @Published private(set) var error: NightscoutError?
    /// The colour thresholds in force (ThresholdStore: the user's, the site's, or Nightscout's defaults).
    @Published private(set) var thresholds: GlucoseThresholds = ThresholdStore.current
    @Published private(set) var settings: FollowSettings = SettingsStore.load()

    /// Called with the newest reading whenever a fetch brings a newer one.
    var onNewReading: ((Reading, Reading?) -> Void)?
    /// Called when the site's own thresholds arrive and change the ones in force.
    var onThresholdsChanged: (() -> Void)?

    let feed = ReadingFeed(client: NightscoutClient(transport: URLSessionTransport()))
    /// Bumped whenever the source changes, so an answer for the previous one never lands.
    private var generation = 0
    private var siteThresholdsRead = false

    var latest: Reading? { readings.first }
    var previous: Reading? { readings.dropFirst().first }

    /// Changes whenever the source does, for `.task(id:)`.
    var sourceKey: String { source.map { $0.stored.site } ?? "" }

    func follow(_ source: FollowSource) {
        let stored = source.stored
        KeychainStore.write("site", stored.site)
        KeychainStore.write("token", stored.token)
        ThresholdStore.site = nil
        // The widgets show nothing of the previous site.
        WidgetSync.clear()
        generation += 1
        siteThresholdsRead = false
        readings = []
        error = nil
        thresholds = ThresholdStore.current
        self.source = source
    }

    /// "Remove this phone": the address, token, thresholds and settings.
    func forget() {
        KeychainStore.delete("site")
        KeychainStore.delete("token")
        InviteAdminStore.clear()
        LiveActivityLayout.clear()
        ThresholdStore.clear()
        SettingsStore.clear()
        WidgetSync.clear()
        generation += 1
        source = nil
        readings = []
        error = nil
        thresholds = ThresholdStore.current
        settings = SettingsStore.load()
    }

    func refresh() async {
        guard let source else { return }
        let asked = generation
        let now = Date()
        let count = ReadingHistory.fetchCount(newest: latest, now: now)
        do {
            let fresh = try await feed.latest(source, count: count, now: now)
            guard asked == generation else { return }
            let before = latest
            readings = ReadingHistory.merge(readings, fresh, now: Date())
            error = nil
            if let newest = latest, newest != before { onNewReading?(newest, previous) }
            // The site's thresholds are optional: read them beside the value, never before it.
            if !siteThresholdsRead, case .nightscout = source {
                siteThresholdsRead = true
                Task { await readSiteThresholds(generation: asked) }
            }
        } catch {
            guard asked == generation else { return }
            self.error = error as? NightscoutError ?? .unreachable
        }
    }

    /// While the screen is visible: nothing until the next reading is due, then every 30 seconds
    /// until it arrives (`RefreshSchedule`). SwiftUI cancels the task when the view goes away.
    func refreshWhileVisible() async {
        while !Task.isCancelled {
            await refresh()
            let delay = RefreshSchedule.delay(newest: latest, now: Date())
            try? await Task.sleep(for: .seconds(delay))
        }
    }

    /// The site's own thresholds, once per site. A site that sends none, or an error, leaves the
    /// defaults; this never blocks showing the value.
    private func readSiteThresholds(generation asked: Int) async {
        guard case .nightscout(let site, let token) = source else { return }
        let client = NightscoutClient(transport: URLSessionTransport())
        let found = try? await client.thresholds(site: site.absoluteString, token: token)
        guard asked == generation else { return }
        ThresholdStore.site = found
        let before = thresholds
        thresholds = ThresholdStore.current
        if thresholds != before { onThresholdsChanged?() }
    }

    // MARK: - Settings

    func update(_ change: (inout FollowSettings) -> Void) {
        var next = settings
        change(&next)
        guard next != settings else { return }
        settings = next
        SettingsStore.save(next)
    }

    /// One stepper press in the shown unit; saved as the user's own values.
    func step(_ kind: GlucoseThresholds.Kind, by steps: Int) {
        let next = thresholds.stepped(kind, by: steps, unit: settings.unit)
        guard next != thresholds else { return }
        ThresholdStore.user = next
        thresholds = ThresholdStore.current
    }

    /// Back to the site's values (or Nightscout's defaults).
    func resetThresholds() {
        ThresholdStore.user = nil
        thresholds = ThresholdStore.current
    }
}
