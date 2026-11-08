import Foundation

/// The link that sets up a phone (plan §3): `https://frejsi.jepsen.ninja/follow#<base64url of
/// {"url":…,"token":…}>`. The site and token sit in the fragment, which a browser never sends to a
/// web server, so they never reach a server log. The same link opens the app as a universal link.
public struct FollowLink: Equatable, Sendable {
    /// The host that serves the universal link and the "get the app" page.
    public static let host = "frejsi.jepsen.ninja"
    public static let path = "/follow"

    /// The Nightscout site, normalised (https, no trailing slash).
    public var site: URL
    /// A Nightscout access token with the `readable` role.
    public var token: String

    public init(site: URL, token: String) {
        self.site = site
        self.token = token
    }

    private struct Payload: Codable {
        var url: String
        var token: String
    }

    /// The link to send someone. Keys are sorted so the same site and token always give the same link.
    public func url() -> URL {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let json = try! encoder.encode(Payload(url: site.absoluteString, token: token))
        return URL(string: "https://\(Self.host)\(Self.path)#\(Self.base64url(json))")!
    }

    /// Reads a link back. Answers nil for anything that is not exactly our host and path with a
    /// fragment holding an https site and a non-empty token.
    public static func parse(_ url: URL) -> FollowLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == host,
              components.path == path || components.path == path + "/",
              let fragment = components.fragment, !fragment.isEmpty,
              let json = fromBase64url(fragment),
              let payload = try? JSONDecoder().decode(Payload.self, from: json)
        else { return nil }
        let token = payload.token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, let site = try? NightscoutClient.normalizeBaseURL(payload.url) else { return nil }
        return FollowLink(site: site, token: token)
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func fromBase64url(_ text: String) -> Data? {
        var base64 = text
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder == 1 { return nil }
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: base64)
    }
}
