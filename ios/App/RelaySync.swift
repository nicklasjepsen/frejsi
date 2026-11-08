import Combine
import FollowCore
import Foundation
import os

/// Keeps this phone's registration with the relay current (contract: `POST /api/live/register`).
/// One request at a time: a change that arrives while one is in flight is sent after it, and only
/// the newest state is sent.
@MainActor
final class RelaySync: ObservableObject {
    @Published private(set) var error: RelayError?

    /// Debug builds get their push tokens from Apple's sandbox, TestFlight and App Store builds
    /// from production; the relay must push through the matching host.
    static var environment: APNsEnvironment {
        #if DEBUG
        return .sandbox
        #else
        return .production
        #endif
    }

    /// A registration identical to the last one sent is repeated at most this often (it moves the
    /// relay's `lastSeenAt` forward; the relay forgets a phone after 30 days without one).
    static let repeatAfter: TimeInterval = 15 * 60

    private let client = RelayClient(transport: URLSessionTransport())
    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "relay")
    private var pending: RelayRegistration?
    private var running = false
    private var lastSent: RelayRegistration?
    private var lastSentAt: Date?
    /// Bumped by `remove()`, so a registration in flight never stores credentials afterwards.
    private var generation = 0

    var isRegistered: Bool { RelayCredentialStore.read() != nil }

    func sync(_ registration: RelayRegistration, force: Bool) {
        if !force, registration == lastSent, let at = lastSentAt, Date().timeIntervalSince(at) < Self.repeatAfter {
            return
        }
        pending = registration
        guard !running else { return }
        running = true
        Task { await drain() }
    }

    private func drain() async {
        while let next = pending {
            pending = nil
            let asked = generation
            do {
                let credentials = try await client.sync(next, credentials: RelayCredentialStore.read())
                guard asked == generation else { continue }
                RelayCredentialStore.write(credentials)
                lastSent = next
                lastSentAt = Date()
                error = nil
                logger.notice("registered")
            } catch {
                guard asked == generation else { continue }
                let failure = error as? RelayError ?? .unreachable
                self.error = failure
                logger.error("register failed: \(String(describing: failure), privacy: .public)")
            }
        }
        running = false
    }

    /// "Remove this phone": deletes the subscription and the relay's copy of the token. Throws when
    /// the relay cannot be reached, so the screen can offer to remove it from the phone only.
    func remove() async throws {
        pending = nil
        generation += 1
        // Let a registration in flight finish first, so it cannot recreate what is deleted.
        for _ in 0..<50 where running {
            try? await Task.sleep(for: .milliseconds(100))
        }
        if let credentials = RelayCredentialStore.read() {
            try await client.delete(credentials)
        }
        forget()
    }

    /// Forgets the registration on the phone only. The relay deletes it by itself after 30 days
    /// without a push or a registration.
    func forget() {
        pending = nil
        generation += 1
        RelayCredentialStore.clear()
        lastSent = nil
        lastSentAt = nil
        error = nil
    }
}
