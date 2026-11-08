import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import FollowCore

private let noon = Date(timeIntervalSince1970: 1_793_016_000) // a five-minute mark

private func reading(_ minutesAgo: Double, _ mgdl: Int, from now: Date = noon) -> Reading {
    Reading(at: now.addingTimeInterval(-minutesAgo * 60), mgdl: mgdl, direction: "Flat")
}

final class DemoCurveTests: XCTestCase {
    func testIsAPureFunctionOfTime() {
        XCTAssertEqual(DemoCurve.latest(now: noon, count: 10), DemoCurve.latest(now: noon, count: 10))
        XCTAssertEqual(DemoCurve.mgdl(at: 1_793_016_000), DemoCurve.mgdl(at: 1_793_016_000))
    }

    func testFollowsTheDocumentedFormula() {
        for t in stride(from: 1_793_016_000.0, to: 1_793_016_000 + 86_400, by: 300) {
            let expected = Int((140 + 55 * sin(2 * Double.pi * t / 10_800) + 18 * sin(2 * Double.pi * t / 2_700 + 1)).rounded(.toNearestOrAwayFromZero))
            XCTAssertEqual(DemoCurve.mgdl(at: t), expected)
        }
    }

    func testReadingsSitOnFiveMinuteMarksNewestFirst() {
        let now = noon.addingTimeInterval(170) // 2 min 50 s past the mark
        let readings = DemoCurve.latest(now: now, count: 4)
        XCTAssertEqual(readings.count, 4)
        XCTAssertEqual(readings[0].at, noon, "the newest is the mark at or before now, never in the future")
        for (newer, older) in zip(readings, readings.dropFirst()) {
            XCTAssertEqual(newer.at.timeIntervalSince(older.at), 300)
        }
        XCTAssertEqual(DemoCurve.latest(now: now, count: 0).count, 1)
    }

    func testStaysPlausibleAndPassesThroughEveryBand() {
        let day = DemoCurve.latest(now: noon, count: 288)
        let values = day.map(\.mgdl)
        XCTAssertGreaterThanOrEqual(values.min()!, 60)
        XCTAssertLessThanOrEqual(values.max()!, 230)
        let bands = Set(values.map { Glucose.band($0, thresholds: .nightscoutDefaults) })
        XCTAssertTrue(bands.isSuperset(of: [.low, .inRange, .high]))
    }

    func testTheArrowFollowsTheChange() {
        for reading in DemoCurve.latest(now: noon, count: 48) {
            let before = DemoCurve.mgdl(at: reading.at.timeIntervalSince1970 - 300)
            let rate = Double(reading.mgdl - before) / 5
            XCTAssertEqual(reading.direction, DemoCurve.direction(perMinute: rate))
            XCTAssertFalse(Glucose.arrow(reading.direction).isEmpty)
        }
        XCTAssertEqual(DemoCurve.direction(perMinute: 0), "Flat")
        XCTAssertEqual(DemoCurve.direction(perMinute: 1.5), "FortyFiveUp")
        XCTAssertEqual(DemoCurve.direction(perMinute: -2), "SingleDown")
        XCTAssertEqual(DemoCurve.direction(perMinute: 3.2), "DoubleUp")
    }

    func testTheFeedServesTheDemoWithoutTheNetwork() async throws {
        let transport = StubTransport(failure: .unreachable)
        let feed = ReadingFeed(client: NightscoutClient(transport: transport))
        let readings = try await feed.latest(.demo, count: 3, now: noon)
        XCTAssertEqual(readings, DemoCurve.latest(now: noon, count: 3))
        XCTAssertTrue(transport.requests.isEmpty)
    }
}

final class ReadingHistoryTests: XCTestCase {
    func testFetchesTheFullHistoryFirstThenOnlyTheGap() {
        XCTAssertEqual(ReadingHistory.fetchCount(newest: nil, now: noon), 150)
        XCTAssertEqual(ReadingHistory.fetchCount(newest: reading(2, 100), now: noon), 3)
        XCTAssertEqual(ReadingHistory.fetchCount(newest: reading(31, 100), now: noon), 9)
        XCTAssertEqual(ReadingHistory.fetchCount(newest: reading(60 * 13, 100), now: noon), 150)
    }

    func testMergesNewestFirstOnePerTimeAndForgetsAfterTwelveHours() {
        let old = [reading(10, 100), reading(5, 110), reading(60 * 12 + 1, 90)]
        let fresh = [reading(0, 130), reading(5, 112)]
        let merged = ReadingHistory.merge(old, fresh, now: noon)
        XCTAssertEqual(merged.map(\.mgdl), [130, 112, 100])
    }

    func testKeepsTheNewestReadingHoweverOld() {
        // A site silent for more than 12 hours still shows its last value (grey, with its age).
        let fresh = [reading(60 * 13, 140), reading(60 * 14, 130)]
        XCTAssertEqual(ReadingHistory.merge([], fresh, now: noon).map(\.mgdl), [140])
        XCTAssertTrue(ReadingHistory.points([reading(60 * 13, 140)], window: .twelveHours, now: noon).isEmpty)
    }

    func testAWindowShowsItsHoursOldestFirst() {
        let readings = [reading(0, 1), reading(170, 2), reading(181, 3), reading(359, 4), reading(361, 5), reading(700, 6)]
        XCTAssertEqual(ReadingHistory.points(readings, window: .threeHours, now: noon).map(\.mgdl), [2, 1])
        XCTAssertEqual(ReadingHistory.points(readings, window: .sixHours, now: noon).map(\.mgdl), [4, 3, 2, 1])
        XCTAssertEqual(ReadingHistory.points(readings, window: .twelveHours, now: noon).map(\.mgdl), [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(CurveWindow.allCases.map(\.hours), [3, 6, 12])
    }

    func testTheAxisCoversReadingsAndTargetRangeOnTwentySteps() {
        let t = GlucoseThresholds.nightscoutDefaults
        XCTAssertEqual(ReadingHistory.yDomainMgdl([], thresholds: t), 60...200)
        XCTAssertEqual(ReadingHistory.yDomainMgdl([reading(0, 45), reading(5, 251)], thresholds: t), 20...280)
        // Every reading the parser accepts (up to 720 mg/dL) stays on the chart.
        XCTAssertEqual(ReadingHistory.yDomainMgdl([reading(0, 720)], thresholds: t), 60...740)
    }

    func testRefreshesAroundTheExpectedNextReading() {
        XCTAssertEqual(RefreshSchedule.delay(newest: nil, now: noon), 30)
        // Read 1 min ago: the next is due in 4 min.
        XCTAssertEqual(RefreshSchedule.delay(newest: reading(1, 100), now: noon), 240)
        // Due in 20 s or overdue: every 30 s until it arrives.
        XCTAssertEqual(RefreshSchedule.delay(newest: reading(4.67, 100), now: noon), 30)
        XCTAssertEqual(RefreshSchedule.delay(newest: reading(25, 100), now: noon), 30)
        // A reading from the future never means waiting longer than one interval.
        XCTAssertEqual(RefreshSchedule.delay(newest: reading(-10, 100), now: noon), 300)
    }
}

final class SetupTests: XCTestCase {
    func testAcceptsAnAddressAndToken() {
        XCTAssertEqual(
            Setup.validate(site: " ns.example.org/ ", token: " fixture-token "),
            .success(.nightscout(site: URL(string: "https://ns.example.org")!, token: "fixture-token"))
        )
    }

    func testSaysWhatIsMissing() {
        XCTAssertEqual(Setup.validate(site: "  ", token: "x"), .failure(.missingAddress))
        XCTAssertEqual(Setup.validate(site: "http://ns.example.org", token: "x"), .failure(.notHTTPS))
        XCTAssertEqual(Setup.validate(site: "https://", token: "x"), .failure(.invalidAddress))
        XCTAssertEqual(Setup.validate(site: "ns.example.org?token=x", token: "x"), .failure(.invalidAddress))
        XCTAssertEqual(Setup.validate(site: "ns.example.org", token: "  "), .failure(.missingToken))
    }

    func testAScannedCodeMustBeAFollowLink() throws {
        let link = FollowLink(site: URL(string: "https://ns.example.org")!, token: "fixture-token")
        XCTAssertEqual(Setup.parseScanned(" \(link.url().absoluteString)\n"), .success(link))
        XCTAssertEqual(Setup.parseScanned("https://ns.example.org"), .failure(.notAFollowLink))
        XCTAssertEqual(Setup.parseScanned("hello"), .failure(.notAFollowLink))
    }

    func testStoresAndRestoresTheSource() {
        let site = FollowSource.nightscout(site: URL(string: "https://ns.example.org")!, token: "fixture-token")
        let stored = site.stored
        XCTAssertEqual(FollowSource.restore(site: stored.site, token: stored.token), site)
        XCTAssertEqual(FollowSource.restore(site: FollowSource.demo.stored.site, token: FollowSource.demo.stored.token), .demo)
        XCTAssertNil(FollowSource.restore(site: nil, token: nil))
        XCTAssertNil(FollowSource.restore(site: "https://ns.example.org", token: ""))
        XCTAssertEqual(site.displayHost, "ns.example.org")
        XCTAssertNil(FollowSource.demo.relayToken)
    }

    func testTheConnectionTestReadsOneEntry() async throws {
        let body = Data(#"[{"sgv":120,"date":1793016000000,"direction":"Flat"}]"#.utf8)
        let transport = StubTransport(body: body)
        let feed = ReadingFeed(client: NightscoutClient(transport: transport))
        let source = FollowSource.nightscout(site: URL(string: "https://ns.example.org")!, token: "fixture-token")
        let result = await feed.test(source)
        XCTAssertEqual(try result.get()?.mgdl, 120)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://ns.example.org/api/v1/entries/sgv.json?count=1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "api-secret"), "fixture-token")
    }

    func testTheConnectionTestReportsARefusedToken() async {
        let feed = ReadingFeed(client: NightscoutClient(transport: StubTransport(status: 401)))
        let source = FollowSource.nightscout(site: URL(string: "https://ns.example.org")!, token: "fixture-token")
        let result = await feed.test(source)
        XCTAssertEqual(result, .failure(.tokenRefused))
    }

    func testAnEmptySiteStillConnects() async {
        let feed = ReadingFeed(client: NightscoutClient(transport: StubTransport(body: Data("[]".utf8))))
        let source = FollowSource.nightscout(site: URL(string: "https://ns.example.org")!, token: "fixture-token")
        let result = await feed.test(source)
        XCTAssertEqual(result, .success(nil))
    }
}

final class FollowSettingsTests: XCTestCase {
    func testDefaults() {
        let settings = FollowSettings.load(nil)
        XCTAssertEqual(settings.unit, .mmolL)
        XCTAssertTrue(settings.liveActivityOn, "on by default after onboarding")
        XCTAssertFalse(settings.alertsOn, "off until the user allows notifications")
        XCTAssertEqual(settings.curveWindow, .sixHours)
    }

    func testRoundTrips() {
        let settings = FollowSettings(unit: .mgdL, liveActivityOn: false, alertsOn: true, curveWindow: .twelveHours)
        XCTAssertEqual(FollowSettings.load(settings.encoded()), settings)
    }

    func testAPartOrDamagedCopyFallsBackField() {
        XCTAssertEqual(FollowSettings.load(Data(#"{"unit":"mgdL"}"#.utf8)).unit, .mgdL)
        XCTAssertTrue(FollowSettings.load(Data(#"{"unit":"mgdL"}"#.utf8)).liveActivityOn)
        XCTAssertEqual(FollowSettings.load(Data(#"{"unit":"furlongs","curveWindow":5}"#.utf8)), .defaults)
        XCTAssertEqual(FollowSettings.load(Data("nonsense".utf8)), .defaults)
    }
}

final class LiveActivitySyncTests: XCTestCase {
    func state(_ minutesAgo: Double, _ mgdl: Int) -> LiveGlucoseState {
        LiveGlucoseState(current: reading(minutesAgo, mgdl), previous: nil)
    }

    func testANewerReadingReplacesTheActivity() {
        XCTAssertTrue(LiveActivitySync.shouldReplace(state(5, 130), with: state(0, 125)))
        XCTAssertTrue(LiveActivitySync.shouldReplace(nil, with: state(0, 125)))
    }

    func testTheSameOrAnOlderReadingNeverDoes() {
        // A late local fetch must not overwrite what the relay pushed.
        XCTAssertFalse(LiveActivitySync.shouldReplace(state(0, 124), with: state(5, 130)))
        XCTAssertFalse(LiveActivitySync.shouldReplace(state(0, 124), with: state(0, 124)))
        XCTAssertFalse(LiveActivitySync.shouldReplace(state(0, 124), with: state(0, 130)))
    }

    func testStatus() {
        XCTAssertEqual(LiveActivitySync.status(wanted: false, running: true), .off)
        XCTAssertEqual(LiveActivitySync.status(wanted: true, running: true), .running)
        XCTAssertEqual(LiveActivitySync.status(wanted: true, running: false), .stopped)
    }
}
