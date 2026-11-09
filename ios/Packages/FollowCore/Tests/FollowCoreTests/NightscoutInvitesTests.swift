import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import FollowCore

/// Answers each request in turn from a list of canned (status, body) pairs.
final class InviteScriptedTransport: HTTPTransport, @unchecked Sendable {
    private var answers: [(Int, Data)]
    private(set) var requests: [URLRequest] = []

    init(_ answers: [(Int, String)]) {
        self.answers = answers.map { ($0.0, Data($0.1.utf8)) }
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        let (status, body) = answers.isEmpty ? (500, Data()) : answers.removeFirst()
        return (body, status)
    }
}

final class NightscoutInvitesTests: XCTestCase {
    let site = URL(string: "https://ns.example.org")!
    let ours = #"{"_id":"64b7f0c2a1b2c3d4e5f60718","name":"naensom Mor #k3x9a","roles":["readable"],"notes":"Created by nænsom","accessToken":"naensommor-fake"}"#
    let ownersAdmin = #"{"_id":"64b7f0c2a1b2c3d4e5f60719","name":"admin","roles":["admin"],"notes":"","accessToken":"admin-fake"}"#
    let ownersReadable = #"{"_id":"64b7f0c2a1b2c3d4e5f6071a","name":"nightguard","roles":["readable"],"accessToken":"nightguard-c0ffee"}"#
    let markedButAdmin = #"{"_id":"64b7f0c2a1b2c3d4e5f6071b","name":"naensom X #1","roles":["readable","admin"],"notes":"Created by nænsom","accessToken":"x-1"}"#

    func testListsOnlyNaensomsReadOnlySubjects() throws {
        let invites = try NightscoutInvites.parseInvites(Data("[\(ours),\(ownersAdmin),\(ownersReadable),\(markedButAdmin)]".utf8))
        XCTAssertEqual(invites, [Invite(id: "64b7f0c2a1b2c3d4e5f60718", name: "Mor", accessToken: "naensommor-fake", subjectName: "naensom Mor #k3x9a")])
    }

    func testSendsTheAdminTokenInTheHeaderNeverInTheURL() async throws {
        let transport = InviteScriptedTransport([(200, "[]")])
        _ = try await NightscoutInvites(transport: transport).list(site: site, adminToken: " admin-fake ")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://ns.example.org/api/v2/authorization/subjects")
        XCTAssertEqual(request.value(forHTTPHeaderField: "api-secret"), "admin-fake")
    }

    func testCreatesAReadOnlySubjectAndAnswersItsToken() async throws {
        let transport = InviteScriptedTransport([(200, "{}"), (200, "PLACEHOLDER")])
        // The list after the POST is built from the name the POST sent, so read it back first.
        let invites = NightscoutInvites(transport: RecordingCreate(inner: transport))
        let invite = try await invites.create(site: site, adminToken: "admin-1", name: "  Mor\n ")
        XCTAssertEqual(invite.name, "Mor")
        XCTAssertTrue(invite.subjectName.hasPrefix("naensom Mor #"))
        XCTAssertEqual(invite.accessToken, "made-by-site")
        let post = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(post.httpMethod, "POST")
        let body = try XCTUnwrap(post.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["roles"] as? [String], ["readable"])
        XCTAssertEqual(json["notes"] as? String, "Created by nænsom")
    }

    func testRemovesOnlyItsOwnSubjects() async throws {
        let list = "[\(ours),\(ownersAdmin)]"
        let transport = InviteScriptedTransport([(200, list), (200, "{}")])
        try await NightscoutInvites(transport: transport).remove(site: site, adminToken: "admin-1", id: "64b7f0c2a1b2c3d4e5f60718")
        XCTAssertEqual(transport.requests.last?.httpMethod, "DELETE")
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/v2/authorization/subjects/64b7f0c2a1b2c3d4e5f60718")

        let refusing = InviteScriptedTransport([(200, list)])
        do {
            try await NightscoutInvites(transport: refusing).remove(site: site, adminToken: "admin-1", id: "64b7f0c2a1b2c3d4e5f60719")
            XCTFail("deleted the owner's own admin subject")
        } catch {}
        XCTAssertFalse(refusing.requests.contains { $0.httpMethod == "DELETE" })
    }

    func testTellsAnAdminTokenFromAReadOnlyOne() async throws {
        let yes = try await NightscoutInvites(transport: InviteScriptedTransport([(200, "[]")])).isAdmin(site: site, adminToken: "a")
        let no = try await NightscoutInvites(transport: InviteScriptedTransport([(401, "")])).isAdmin(site: site, adminToken: "r")
        XCTAssertTrue(yes)
        XCTAssertFalse(no)
    }

    func testDisplayNames() {
        XCTAssertEqual(NightscoutInvites.displayName("naensom Lærer Anne #zz9"), "Lærer Anne")
        XCTAssertEqual(NightscoutInvites.cleanName("  a\nb  "), "a b")
        XCTAssertEqual(NightscoutInvites.cleanName(String(repeating: "x", count: 50)).count, 40)
    }
}

/// Lets the POST through, then answers the list with a subject named as the POST asked.
final class RecordingCreate: HTTPTransport, @unchecked Sendable {
    let inner: InviteScriptedTransport
    private var postedName: String?

    init(inner: InviteScriptedTransport) { self.inner = inner }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        let answer = try await inner.send(request)
        if request.httpMethod == "POST", let body = request.httpBody,
           let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            postedName = json["name"] as? String
            return answer
        }
        guard let postedName else { return answer }
        let list = #"[{"_id":"64b7f0c2a1b2c3d4e5f60720","name":"\#(postedName)","roles":["readable"],"notes":"Created by nænsom","accessToken":"made-by-site"}]"#
        return (Data(list.utf8), 200)
    }
}
