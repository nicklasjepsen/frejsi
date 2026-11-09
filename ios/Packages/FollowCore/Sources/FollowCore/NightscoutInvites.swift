import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One person invited from nænsom: a Nightscout subject with only the `readable` role, made by
/// `NightscoutInvites.create`. Its access token is what goes in that person's follow link.
public struct Invite: Equatable, Sendable, Identifiable {
    /// Nightscout's `_id` for the subject.
    public var id: String
    /// The name the owner typed, without nænsom's prefix.
    public var name: String
    public var accessToken: String
    /// The subject's full name in Nightscout ("naensom Mor #k3x9a").
    public var subjectName: String

    public init(id: String, name: String, accessToken: String, subjectName: String) {
        self.id = id
        self.name = name
        self.accessToken = accessToken
        self.subjectName = subjectName
    }
}

/// The one exception to "glucose sources are read-only" (owner, 2026-11-09): with an admin token
/// the owner adds on his own phone, nænsom creates and deletes **read-only** access tokens for the
/// people he invites, through Nightscout's authorization API
/// (`/api/v2/authorization/subjects`). Nothing else is ever written: never entries, treatments,
/// settings, profiles or any other subject.
///
/// - Every subject it creates has the role `readable` and nothing more, and carries `marker` in its
///   notes; `list` shows only subjects with that marker and only the `readable` role, and
///   `remove` refuses an id that is not in that list, so the owner's own subjects are never
///   touched.
/// - The admin token goes in the `api-secret` header, like the read-only one, never in a URL; the
///   app keeps it in its own Keychain group (not the widgets'), and never sends it to the relay.
public struct NightscoutInvites: Sendable {
    public static let subjectsPath = "/api/v2/authorization/subjects"
    /// In the notes of every subject nænsom creates; how `list` tells them from the owner's own.
    public static let marker = "Created by nænsom"
    /// Prefixed to the typed name, so the subject reads as nænsom's in Nightscout's admin page.
    public static let namePrefix = "naensom "
    public static let readableRole = "readable"

    private let transport: HTTPTransport

    public init(transport: HTTPTransport) {
        self.transport = transport
    }

    /// True when the token may manage subjects (it can read the subject list); false when the site
    /// refuses it. Other answers throw.
    public func isAdmin(site: URL, adminToken: String) async throws -> Bool {
        let (_, status) = try await transport.send(Self.request(site: site, token: adminToken, method: "GET", path: Self.subjectsPath))
        if status == 401 || status == 403 { return false }
        guard (200..<300).contains(status) else { throw NightscoutError.status(status) }
        return true
    }

    /// The people invited from nænsom, oldest first.
    public func list(site: URL, adminToken: String) async throws -> [Invite] {
        let (body, status) = try await transport.send(Self.request(site: site, token: adminToken, method: "GET", path: Self.subjectsPath))
        try Self.check(status)
        return try Self.parseInvites(body)
    }

    /// Creates a read-only subject for `name` and answers it with its access token.
    public func create(site: URL, adminToken: String, name: String) async throws -> Invite {
        let display = Self.cleanName(name)
        guard !display.isEmpty else { throw NightscoutError.invalidAddress }
        // A short random suffix keeps two people with the same name apart, and lets the new subject
        // be found again exactly in the list afterwards.
        let suffix = String(UInt32.random(in: 0..<UInt32.max), radix: 36)
        let subjectName = "\(Self.namePrefix)\(display) #\(suffix)"
        let body = try JSONSerialization.data(withJSONObject: [
            "name": subjectName,
            "roles": [Self.readableRole],
            "notes": Self.marker,
        ], options: [.sortedKeys])
        let (_, status) = try await transport.send(Self.request(site: site, token: adminToken, method: "POST", path: Self.subjectsPath, body: body))
        try Self.check(status)
        let invites = try await list(site: site, adminToken: adminToken)
        guard let created = invites.last(where: { $0.subjectName == subjectName }) else {
            throw NightscoutError.notNightscout
        }
        return created
    }

    /// Deletes an invited person's subject, so their token stops working at once. Only an id from
    /// `list` (nænsom's own read-only subjects) is ever deleted.
    public func remove(site: URL, adminToken: String, id: String) async throws {
        let invites = try await list(site: site, adminToken: adminToken)
        guard invites.contains(where: { $0.id == id }), Self.isSubjectId(id) else { throw NightscoutError.status(404) }
        let (_, status) = try await transport.send(Self.request(site: site, token: adminToken, method: "DELETE", path: "\(Self.subjectsPath)/\(id)"))
        if status == 404 { return }
        try Self.check(status)
    }

    // MARK: - Pieces the tests check

    public static func request(site: URL, token: String, method: String, path: String, body: Data? = nil) -> URLRequest {
        var components = URLComponents(url: site, resolvingAgainstBaseURL: false)!
        components.path = components.path + path
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(token.trimmingCharacters(in: .whitespacesAndNewlines), forHTTPHeaderField: "api-secret")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// Nænsom's own read-only subjects from Nightscout's subject list, in the order the site sent.
    /// Anything without the marker, with any role besides `readable`, or without an id or token is
    /// left out.
    public static func parseInvites(_ data: Data) throws -> [Invite] {
        guard let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else { throw NightscoutError.notNightscout }
        var invites: [Invite] = []
        for case let subject as [String: Any] in array {
            guard let id = subject["_id"] as? String, isSubjectId(id),
                  let name = subject["name"] as? String,
                  let token = subject["accessToken"] as? String, !token.isEmpty,
                  let roles = subject["roles"] as? [String], roles == [readableRole],
                  isOurs(name: name, notes: subject["notes"] as? String)
            else { continue }
            invites.append(Invite(id: id, name: displayName(name), accessToken: token, subjectName: name))
        }
        return invites
    }

    /// A subject nænsom made: the marker in its notes, or, because Nightscout releases before the
    /// notes fix do not send `notes` in the subject list, a name in nænsom's own shape
    /// ("naensom <name> #<suffix>").
    static func isOurs(name: String, notes: String?) -> Bool {
        if let notes, notes.contains(marker) { return true }
        guard name.hasPrefix(namePrefix), let hash = name.range(of: " #", options: .backwards) else { return false }
        let suffix = name[hash.upperBound...]
        return !suffix.isEmpty && suffix.allSatisfy { $0.isLetter || $0.isNumber }
    }

    /// "naensom Mor #k3x9a" → "Mor": the name the owner typed.
    static func displayName(_ subjectName: String) -> String {
        var name = subjectName.hasPrefix(namePrefix) ? String(subjectName.dropFirst(namePrefix.count)) : subjectName
        if let hash = name.range(of: " #", options: .backwards) { name = String(name[..<hash.lowerBound]) }
        return name
    }

    /// The typed name, trimmed, on one line, at most 40 characters.
    public static func cleanName(_ name: String) -> String {
        let oneLine = name.components(separatedBy: .newlines).joined(separator: " ")
        return String(oneLine.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
    }

    /// A MongoDB ObjectId: 24 hex digits. Anything else never goes into a DELETE path.
    static func isSubjectId(_ id: String) -> Bool {
        id.count == 24 && id.allSatisfy(\.isHexDigit)
    }

    private static func check(_ status: Int) throws {
        if status == 401 || status == 403 { throw NightscoutError.tokenRefused }
        guard (200..<300).contains(status) else { throw NightscoutError.status(status) }
    }
}
