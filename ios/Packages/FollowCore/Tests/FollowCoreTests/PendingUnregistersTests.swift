import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import FollowCore

final class PendingUnregistersTests: XCTestCase {
    func credentials(_ n: Int) -> RelayCredentials {
        RelayCredentials(subscriptionId: "sub-\(n)", deviceSecret: "secret-\(n)")
    }

    func testANewRemovalIsAddedBesideTheOnesWaiting() {
        var pending = PendingUnregisters()
        pending.add(credentials(1))
        pending.add(credentials(2))
        XCTAssertEqual(pending.entries, [credentials(1), credentials(2)])
    }

    func testTheSameSubscriptionAgainReplacesTheEarlierEntry() {
        var pending = PendingUnregisters(entries: [credentials(1), credentials(2)])
        pending.add(RelayCredentials(subscriptionId: "sub-1", deviceSecret: "newer"))
        XCTAssertEqual(pending.entries.map(\.subscriptionId), ["sub-2", "sub-1"])
        XCTAssertEqual(pending.entries.last?.deviceSecret, "newer")
    }

    func testEmptyCredentialsAreNotKept() {
        var pending = PendingUnregisters()
        pending.add(RelayCredentials(subscriptionId: "", deviceSecret: "s"))
        pending.add(RelayCredentials(subscriptionId: "x", deviceSecret: ""))
        XCTAssertTrue(pending.isEmpty)
    }

    func testTheListStaysSmallAndDropsTheOldestFirst() {
        var pending = PendingUnregisters()
        for n in 1...(PendingUnregisters.limit + 2) { pending.add(credentials(n)) }
        XCTAssertEqual(pending.entries.count, PendingUnregisters.limit)
        XCTAssertEqual(pending.entries.first, credentials(3))
        XCTAssertEqual(pending.entries.last, credentials(PendingUnregisters.limit + 2))
    }

    func testConfirmedRemovalsAreDroppedAndTheRestKept() {
        var pending = PendingUnregisters(entries: [credentials(1), credentials(2), credentials(3)])
        pending.remove(["sub-1", "sub-3", "sub-9"])
        XCTAssertEqual(pending.entries, [credentials(2)])
    }

    func testWhichAnswersMeanTheSubscriptionIsGone() {
        for status in [200, 204, 401, 404] {
            XCTAssertTrue(PendingUnregisters.isDone(status: status), "\(status)")
        }
        for status in [400, 403, 408, 429, 500, 502, 503] {
            XCTAssertFalse(PendingUnregisters.isDone(status: status), "\(status)")
        }
    }

    func testItTriesWhenSomethingWaitsAndNotMomentsAfterTheLastAttempt() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertFalse(PendingUnregisters().isDue(now: now, lastAttemptAt: nil))
        let pending = PendingUnregisters(entries: [credentials(1)])
        XCTAssertTrue(pending.isDue(now: now, lastAttemptAt: nil))
        XCTAssertFalse(pending.isDue(now: now, lastAttemptAt: now.addingTimeInterval(-5)))
        XCTAssertTrue(pending.isDue(now: now, lastAttemptAt: now.addingTimeInterval(-PendingUnregisters.retryAfter)))
        // A clock set back does not stop the retries.
        XCTAssertTrue(pending.isDue(now: now, lastAttemptAt: now.addingTimeInterval(3600)))
    }

    func testTheKeychainFormRoundTripsAndAnUnreadableOneIsEmpty() {
        let pending = PendingUnregisters(entries: [credentials(1), credentials(2)])
        XCTAssertEqual(PendingUnregisters.decode(pending.encoded()), pending)
        XCTAssertEqual(PendingUnregisters.decode(nil), PendingUnregisters())
        XCTAssertEqual(PendingUnregisters.decode("not json"), PendingUnregisters())
    }

    func testUnregisterSendsTheDeleteWithTheSecret() async throws {
        let transport = ScriptedTransport([.answer(204, "")])
        let gone = await RelayClient(transport: transport).unregister(credentials(1))
        XCTAssertTrue(gone)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.lastPathComponent, "sub-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-secret"), "secret-1")
    }

    func testUnregisterTriesAgainWithoutAnAnswerOrAfterAFailure() async {
        let none = await RelayClient(transport: ScriptedTransport([.fail])).unregister(credentials(1))
        XCTAssertFalse(none)
        let busy = await RelayClient(transport: ScriptedTransport([.answer(503, "")])).unregister(credentials(1))
        XCTAssertFalse(busy)
        let gone = await RelayClient(transport: ScriptedTransport([.answer(401, #"{"error":"bad-device-secret"}"#)]))
            .unregister(credentials(1))
        XCTAssertTrue(gone)
    }

    func testRetryAnswersTheOnesThatAreGone() async {
        let transport = ScriptedTransport([.answer(204, ""), .fail, .answer(404, ""), .answer(500, "")])
        let pending = PendingUnregisters(entries: (1...4).map(credentials))
        let gone = await RelayClient(transport: transport).retry(pending)
        XCTAssertEqual(gone, ["sub-1", "sub-3"])
        XCTAssertEqual(transport.requests.count, 4)

        // What is still waiting, plus a removal added while the attempt ran.
        var now = pending
        now.add(credentials(5))
        now.remove(gone)
        XCTAssertEqual(now.entries.map(\.subscriptionId), ["sub-2", "sub-4", "sub-5"])
    }
}
