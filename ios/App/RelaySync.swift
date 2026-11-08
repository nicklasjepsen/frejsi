import Combine
import FollowCore
import Foundation
import os

/// Keeps this phone's registration with the relay current (contract: `POST /api/live/register`).
/// One request at a time: a change that arrives while one is in flight is sent after it, and only
/// the newest state is sent. A failure that may pass (no network, a busy relay) is retried with
/// backoff, so the phone registers once the network is back without anyone touching it.
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
    static let firstRetry: TimeInterval = 30
    static let longestRetry: TimeInterval = 15 * 60

    private let client = RelayClient(transport: URLSessionTransport())
    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "relay")
    private var pending: RelayRegistration?
    private var running = false
    private var removing = false
    private var lastSent: RelayRegistration?
    private var lastSentAt: Date?
    private var retryDelay = RelaySync.firstRetry
    private var retryTask: Task<Void, Never>?
    private var drainTask: Task<Void, Never>?

    func sync(_ registration: RelayRegistration, force: Bool) {
        guard !removing else { return }
        if !force, registration == lastSent, let at = lastSentAt, Date().timeIntervalSince(at) < Self.repeatAfter {
            return
        }
        retryTask?.cancel()
        retryTask = nil
        pending = registration
        guard !running else { return }
        running = true
        drainTask = Task { await drain() }
    }

    private func drain() async {
        while let next = pending, !removing {
            pending = nil
            do {
                // Credentials are always stored, even during "Remove this phone": the removal
                // needs them to delete what this request created.
                let credentials = try await client.sync(next, credentials: RelayCredentialStore.read())
                RelayCredentialStore.write(credentials)
                lastSent = next
                lastSentAt = Date()
                retryDelay = Self.firstRetry
                error = nil
                logger.notice("registered")
            } catch {
                let failure = error as? RelayError ?? .unreachable
                self.error = failure
                logger.error("register failed: \(String(describing: failure), privacy: .public)")
                if failure.isTransient, pending == nil, !removing { scheduleRetry(next) }
            }
        }
        running = false
    }

    private func scheduleRetry(_ registration: RelayRegistration) {
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, Self.longestRetry)
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.sync(registration, force: true)
        }
    }

    /// "Remove this phone": deletes the subscription and the relay's copy of the token. Throws when
    /// the relay cannot be reached, so the screen can offer to remove it from the phone only.
    func remove() async throws {
        removing = true
        defer { removing = false }
        pending = nil
        retryTask?.cancel()
        retryTask = nil
        // Let a registration in flight finish first (each request times out after 20 s), so its
        // credentials are stored and what it created is deleted too.
        await drainTask?.value
        if let credentials = RelayCredentialStore.read() {
            try await client.delete(credentials)
        }
        forget()
    }

    /// Forgets the registration on the phone only. The relay deletes it by itself after 30 days
    /// without a push or a registration.
    func forget() {
        pending = nil
        retryTask?.cancel()
        retryTask = nil
        RelayCredentialStore.clear()
        lastSent = nil
        lastSentAt = nil
        retryDelay = Self.firstRetry
        error = nil
    }
}
