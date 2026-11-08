import Foundation

/// What the app follows: a Nightscout site with a read-only token, or the made-up demo curve.
public enum FollowSource: Equatable, Sendable {
    case nightscout(site: URL, token: String)
    case demo

    /// The two values kept in the Keychain. The demo is stored as the site "demo" with no token.
    public var stored: (site: String, token: String) {
        switch self {
        case .nightscout(let site, let token): return (site.absoluteString, token)
        case .demo: return (DemoCurve.siteMarker, "")
        }
    }

    /// Reads back what `stored` gave; nil when nothing usable is stored.
    public static func restore(site: String?, token: String?) -> FollowSource? {
        guard let site, !site.isEmpty else { return nil }
        if site == DemoCurve.siteMarker { return .demo }
        guard let token, !token.isEmpty, let url = try? NightscoutClient.normalizeBaseURL(site) else { return nil }
        return .nightscout(site: url, token: token)
    }

    /// What the relay is told (`nightscoutUrl`, `nightscoutToken`).
    public var relayURL: String {
        switch self {
        case .nightscout(let site, _): return site.absoluteString
        case .demo: return DemoCurve.siteMarker
        }
    }

    public var relayToken: String? {
        switch self {
        case .nightscout(_, let token): return token
        case .demo: return nil
        }
    }

    public var isDemo: Bool { self == .demo }

    /// The site's host, to show which site the phone follows without showing the token.
    public var displayHost: String? {
        switch self {
        case .nightscout(let site, _): return site.host
        case .demo: return nil
        }
    }
}

/// Why typed or scanned setup details cannot be used yet. The app words each one in da and en.
public enum SetupProblem: Error, Equatable, Sendable {
    case missingAddress
    case invalidAddress
    case notHTTPS
    case missingToken
    case notAFollowLink
}

public enum Setup {
    /// The address and token as typed: the address normalised to https, both trimmed.
    public static func validate(site: String, token: String) -> Result<FollowSource, SetupProblem> {
        let trimmedSite = site.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedSite.isEmpty { return .failure(.missingAddress) }
        let url: URL
        do {
            url = try NightscoutClient.normalizeBaseURL(trimmedSite)
        } catch NightscoutError.notHTTPS {
            return .failure(.notHTTPS)
        } catch {
            return .failure(.invalidAddress)
        }
        if trimmedToken.isEmpty { return .failure(.missingToken) }
        return .success(.nightscout(site: url, token: trimmedToken))
    }

    /// A QR code's text: only the follow link (`https://naensom.jepsen.ninja/follow#…`) is accepted.
    public static func parseScanned(_ text: String) -> Result<FollowLink, SetupProblem> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let link = FollowLink.parse(url) else { return .failure(.notAFollowLink) }
        return .success(link)
    }
}

/// Where the app's readings come from: Nightscout, or the demo curve with no network.
public struct ReadingFeed: Sendable {
    private let client: NightscoutClient

    public init(client: NightscoutClient) {
        self.client = client
    }

    /// The newest `count` readings, newest first.
    public func latest(_ source: FollowSource, count: Int, now: Date = Date()) async throws -> [Reading] {
        switch source {
        case .demo:
            return DemoCurve.latest(now: now, count: count)
        case .nightscout(let site, let token):
            return try await client.latest(site: site.absoluteString, token: token, count: count)
        }
    }

    /// "Test connection" (plan §3): reads one entry. Succeeds with the newest reading, or with nil
    /// when the site answers but has no readings yet.
    public func test(_ source: FollowSource, now: Date = Date()) async -> Result<Reading?, NightscoutError> {
        do {
            return .success(try await latest(source, count: 1, now: now).first)
        } catch let error as NightscoutError {
            return .failure(error)
        } catch {
            return .failure(.unreachable)
        }
    }
}
