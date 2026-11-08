import Combine
import FollowCore
import Foundation

/// Reads Nightscout while the app is on screen. Nothing here keeps the lock screen current: that is
/// the relay's pushes (plan §0). This only shows the value and its age in the app.
@MainActor
final class FollowModel: ObservableObject {
    @Published private(set) var site: String = KeychainStore.read("site") ?? ""
    @Published private(set) var token: String = KeychainStore.read("token") ?? ""
    @Published private(set) var readings: [Reading] = []
    @Published private(set) var error: String?
    @Published private(set) var lastChecked: Date?
    /// The colour thresholds in force (ThresholdStore: the user's, the site's, or Nightscout's defaults).
    @Published private(set) var thresholds: GlucoseThresholds = ThresholdStore.current
    private var siteThresholdsRead = false

    private let client = NightscoutClient(transport: URLSessionTransport())
    /// Bumped on every save, so an answer for the previous site never lands under the new one.
    private var generation = 0

    var isConfigured: Bool { !site.isEmpty && !token.isEmpty }
    var latest: Reading? { readings.first }
    var previous: Reading? { readings.dropFirst().first }

    func save(site: String, token: String) {
        let trimmedSite = site.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        KeychainStore.write("site", trimmedSite)
        KeychainStore.write("token", trimmedToken)
        self.site = trimmedSite
        self.token = trimmedToken
        generation += 1
        siteThresholdsRead = false
        readings = []
        error = nil
        Task { await refresh() }
    }

    func refresh() async {
        guard isConfigured else { return }
        let asked = generation
        let result: Result<[Reading], NightscoutError>
        do {
            result = .success(try await client.latest(site: site, token: token, count: 3))
        } catch let failure as NightscoutError {
            result = .failure(failure)
        } catch {
            result = .failure(.unreachable)
        }
        guard asked == generation else { return }
        // The site's thresholds are optional: read them beside the value, never before it.
        if !siteThresholdsRead, case .success = result {
            siteThresholdsRead = true
            Task { await readSiteThresholds(generation: asked) }
        }
        switch result {
        case .success(let latest):
            readings = latest
            error = nil
        case .failure(let failure):
            error = failure.message(in: AppLanguage.current)
        }
        lastChecked = Date()
    }

    /// The site's own thresholds, once per saved site. A site that sends none, or an error, leaves
    /// the defaults; this never blocks showing the value.
    private func readSiteThresholds(generation asked: Int) async {
        let found = try? await client.thresholds(site: site, token: token)
        guard asked == generation else { return }
        ThresholdStore.site = found
        thresholds = ThresholdStore.current
    }

    /// One stepper press in the shown unit; saved as the user's own values.
    func step(_ kind: GlucoseThresholds.Kind, by steps: Int, unit: GlucoseUnit) {
        let next = thresholds.stepped(kind, by: steps, unit: unit)
        guard next != thresholds else { return }
        ThresholdStore.user = next
        thresholds = ThresholdStore.current
    }

    /// Back to the site's values (or Nightscout's defaults).
    func resetThresholds() {
        ThresholdStore.user = nil
        thresholds = ThresholdStore.current
    }

    /// Every 30 seconds while the screen is visible; SwiftUI cancels the task when it goes away.
    func refreshWhileVisible() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(30))
        }
    }
}
