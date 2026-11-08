import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import FollowCore

/// Answers each request with the next canned reply and records what was sent.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    enum Reply {
        case answer(Int, String)
        case fail
    }

    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [Reply]) {
        self.replies = replies
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        guard !replies.isEmpty else { throw NightscoutError.unreachable }
        switch replies.removeFirst() {
        case .answer(let status, let body): return (Data(body.utf8), status)
        case .fail: throw NightscoutError.timedOut
        }
    }
}

private func json(_ request: URLRequest) throws -> [String: Any] {
    let body = try XCTUnwrap(request.httpBody)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
}

final class RelayClientTests: XCTestCase {
    let site = URL(string: "https://ns.example.org")!
    let started = Date(timeIntervalSince1970: 1_793_016_000)

    func registration(liveOn: Bool = true, alertsOn: Bool = true, source: FollowSource? = nil) -> RelayRegistration {
        RelayRegistration.make(
            source: source ?? .nightscout(site: site, token: "fixture-token"),
            settings: FollowSettings(unit: .mmolL, liveActivityOn: liveOn, alertsOn: alertsOn, curveWindow: .sixHours),
            thresholds: .nightscoutDefaults,
            tokens: LivePushTokens(pushToStart: "aa01", activity: "bb02", activityStartedAt: started, device: "cc03"),
            language: .da,
            environment: .sandbox
        )
    }

    func testTheBaseURLIsTheRelay() {
        XCTAssertEqual(RelayConfig.baseURL.absoluteString, "https://frejsi-poller-cniydvxtxktqa.azurewebsites.net/api")
    }

    func testCreateSendsEveryFieldOfTheContract() async throws {
        let transport = ScriptedTransport([.answer(200, #"{"subscriptionId":"sub-1","deviceSecret":"secret-1"}"#)])
        let credentials = try await RelayClient(transport: transport).sync(registration(), credentials: nil)
        XCTAssertEqual(credentials, RelayCredentials(subscriptionId: "sub-1", deviceSecret: "secret-1"))

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://frejsi-poller-cniydvxtxktqa.azurewebsites.net/api/live/register")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "x-device-secret"))
        let body = try json(request)
        XCTAssertNil(body["subscriptionId"], "absent on create")
        XCTAssertEqual(body["nightscoutUrl"] as? String, "https://ns.example.org")
        XCTAssertEqual(body["nightscoutToken"] as? String, "fixture-token")
        XCTAssertEqual(body["pushToStartToken"] as? String, "aa01")
        XCTAssertEqual(body["activityPushToken"] as? String, "bb02")
        XCTAssertEqual(body["activityStartedAt"] as? String, "2026-10-26T12:00:00Z")
        XCTAssertEqual(body["deviceToken"] as? String, "cc03")
        XCTAssertEqual(body["apnsEnvironment"] as? String, "sandbox")
        XCTAssertEqual(body["unit"] as? String, "mmolL")
        XCTAssertEqual(body["alertsOn"] as? Bool, true)
        XCTAssertEqual(body["language"] as? String, "da")
        let thresholds = try XCTUnwrap(body["thresholds"] as? [String: Any])
        XCTAssertEqual(thresholds["urgentLowMgdl"] as? Int, 55)
        XCTAssertEqual(thresholds["lowMgdl"] as? Int, 80)
        XCTAssertEqual(thresholds["highMgdl"] as? Int, 180)
        XCTAssertEqual(thresholds["urgentHighMgdl"] as? Int, 260)
        XCTAssertEqual(Set(body.keys), [
            "nightscoutUrl", "nightscoutToken", "pushToStartToken", "activityPushToken", "activityStartedAt",
            "deviceToken", "apnsEnvironment", "unit", "thresholds", "alertsOn", "language",
        ])
    }

    func testUpdateSendsTheSecretAndKeepsTheStoredToken() async throws {
        let transport = ScriptedTransport([.answer(200, #"{"subscriptionId":"sub-1"}"#)])
        let old = RelayCredentials(subscriptionId: "sub-1", deviceSecret: "secret-1")
        let credentials = try await RelayClient(transport: transport).sync(registration(), credentials: old)
        XCTAssertEqual(credentials, old, "the secret is kept: an update does not return it")

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-secret"), "secret-1")
        let body = try json(request)
        XCTAssertEqual(body["subscriptionId"] as? String, "sub-1")
        XCTAssertNil(body["nightscoutToken"], "omitted on update")
        XCTAssertEqual(body["nightscoutUrl"] as? String, "https://ns.example.org")
    }

    func testAForgottenPhoneRegistersAgain() async throws {
        let transport = ScriptedTransport([
            .answer(401, #"{"error":"bad-device-secret"}"#),
            .answer(200, #"{"subscriptionId":"sub-2","deviceSecret":"secret-2"}"#),
        ])
        let old = RelayCredentials(subscriptionId: "sub-1", deviceSecret: "stale")
        let credentials = try await RelayClient(transport: transport).sync(registration(), credentials: old)
        XCTAssertEqual(credentials, RelayCredentials(subscriptionId: "sub-2", deviceSecret: "secret-2"))
        XCTAssertEqual(transport.requests.count, 2)
        let retry = try json(transport.requests[1])
        XCTAssertNil(retry["subscriptionId"])
        XCTAssertEqual(retry["nightscoutToken"] as? String, "fixture-token", "a new subscription needs the token")
        XCTAssertNil(transport.requests[1].value(forHTTPHeaderField: "x-device-secret"))
    }

    func testLiveActivityOffSendsNoActivityTokens() throws {
        let off = registration(liveOn: false, alertsOn: false)
        XCTAssertNil(off.pushToStartToken)
        XCTAssertNil(off.activityPushToken)
        XCTAssertNil(off.activityStartedAt)
        XCTAssertNil(off.deviceToken)
        XCTAssertFalse(off.alertsOn)

        let request = RelayClient(transport: ScriptedTransport([])).registerRequest(off, credentials: nil)
        let body = try json(request)
        // Present as null, as the contract spells them, not missing.
        XCTAssertTrue(body["pushToStartToken"] is NSNull)
        XCTAssertTrue(body["activityPushToken"] is NSNull)
        XCTAssertTrue(body["activityStartedAt"] is NSNull)
        XCTAssertTrue(body["deviceToken"] is NSNull)
    }

    func testTheDemoRegistersWithoutAToken() throws {
        let demo = registration(source: .demo)
        XCTAssertEqual(demo.nightscoutUrl, "demo")
        XCTAssertNil(demo.nightscoutToken)
        let body = try json(RelayClient(transport: ScriptedTransport([])).registerRequest(demo, credentials: nil))
        XCTAssertEqual(body["nightscoutUrl"] as? String, "demo")
        XCTAssertNil(body["nightscoutToken"])
    }

    func testErrorsFromTheContract() async {
        let cases: [(Int, String, RelayError)] = [
            (400, #"{"error":"validation"}"#, .validation),
            (400, #"{"error":"not-https"}"#, .notHTTPS),
            (422, #"{"error":"nightscout-refused"}"#, .nightscoutRefused),
            (422, #"{"error":"nightscout-unreachable"}"#, .nightscoutUnreachable),
            (429, #"{"error":"rate-limited"}"#, .rateLimited),
            (500, "oops", .status(500)),
            (200, "{}", .badResponse),
            (200, #"{"subscriptionId":"sub-1"}"#, .badResponse), // a create must return the secret
        ]
        for (status, body, expected) in cases {
            let client = RelayClient(transport: ScriptedTransport([.answer(status, body)]))
            do {
                _ = try await client.sync(registration(), credentials: nil)
                XCTFail("\(status) \(body) should fail")
            } catch {
                XCTAssertEqual(error as? RelayError, expected, "\(status) \(body)")
            }
        }
    }

    func testNoConnectionIsUnreachable() async {
        let client = RelayClient(transport: ScriptedTransport([.fail]))
        do {
            _ = try await client.sync(registration(), credentials: nil)
            XCTFail("should fail")
        } catch {
            XCTAssertEqual(error as? RelayError, .unreachable)
        }
    }

    func testDeleteSendsTheSecret() async throws {
        let transport = ScriptedTransport([.answer(204, "")])
        try await RelayClient(transport: transport).delete(RelayCredentials(subscriptionId: "sub-1", deviceSecret: "secret-1"))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.absoluteString, "https://frejsi-poller-cniydvxtxktqa.azurewebsites.net/api/live/register/sub-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-secret"), "secret-1")
        XCTAssertNil(request.httpBody)
    }

    func testDeletingWhatIsAlreadyGoneSucceeds() async throws {
        try await RelayClient(transport: ScriptedTransport([.answer(404, "")])).delete(RelayCredentials(subscriptionId: "x", deviceSecret: "y"))
    }

    func testDeleteWithAWrongSecretFails() async {
        do {
            try await RelayClient(transport: ScriptedTransport([.answer(401, #"{"error":"bad-device-secret"}"#)]))
                .delete(RelayCredentials(subscriptionId: "x", deviceSecret: "y"))
            XCTFail("should fail")
        } catch {
            XCTAssertEqual(error as? RelayError, .badDeviceSecret)
        }
    }
}
