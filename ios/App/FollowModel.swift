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
        readings = []
        error = nil
        Task { await refresh() }
    }

    func refresh() async {
        guard isConfigured else { return }
        let asked = generation
        let result: Result<[Reading], NightscoutError>
        do {
            result = .success(try await client.latest(site: site, token: token, count: 2))
        } catch let failure as NightscoutError {
            result = .failure(failure)
        } catch {
            result = .failure(.unreachable)
        }
        guard asked == generation else { return }
        switch result {
        case .success(let latest):
            readings = latest
            error = nil
        case .failure(let failure):
            error = failure.message
        }
        lastChecked = Date()
    }

    /// Every 30 seconds while the screen is visible; SwiftUI cancels the task when it goes away.
    func refreshWhileVisible() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(30))
        }
    }
}
