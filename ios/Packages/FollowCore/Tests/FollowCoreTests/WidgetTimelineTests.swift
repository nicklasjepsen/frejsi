import Foundation
import XCTest
@testable import FollowCore

private let noon = Date(timeIntervalSince1970: 1_793_016_000) // a five-minute mark
private let site = "https://ns.example.org"
private let source = FollowSource.nightscout(site: URL(string: site)!, token: "fixture-token")

private func reading(_ minutesAgo: Double, _ mgdl: Int, direction: String = "Flat") -> Reading {
    Reading(at: noon.addingTimeInterval(-minutesAgo * 60), mgdl: mgdl, direction: direction)
}

private func snapshot(_ minutesAgo: Double, _ mgdl: Int = 140, previous: Reading? = nil, site: String = site) -> GlucoseSnapshot {
    GlucoseSnapshot(site: site, current: reading(minutesAgo, mgdl), previous: previous)
}

final class GlucoseSnapshotTests: XCTestCase {
    func testRoundTripsThroughTheAppGroupWithUnixSeconds() throws {
        let saved = snapshot(3, 151, previous: reading(8, 145))
        let data = saved.encoded()
        XCTAssertEqual(GlucoseSnapshot.decode(data), saved)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let current = try XCTUnwrap(json["current"] as? [String: Any])
        XCTAssertEqual(current["at"] as? Double, noon.timeIntervalSince1970 - 180, "Unix seconds, like the relay's readingAt")
    }

    func testAnUnreadableOrMissingCopyIsNoSnapshot() {
        XCTAssertNil(GlucoseSnapshot.decode(nil))
        XCTAssertNil(GlucoseSnapshot.decode(Data("{".utf8)))
        XCTAssertNil(GlucoseSnapshot.decode(Data("{\"site\":\"x\"}".utf8)))
    }

    func testCarriesTheChangeLikeTheLiveActivity() {
        let withPrevious = snapshot(0, 151, previous: reading(5, 145))
        XCTAssertEqual(withPrevious.state, LiveGlucoseState(mgdl: 151, direction: "Flat", delta: 6, readingAt: noon))
        XCTAssertNil(snapshot(0, 151, previous: reading(20, 145)).state.delta, "no change across a gap")
        XCTAssertTrue(snapshot(0, site: DemoCurve.siteMarker).isDemo)
        XCTAssertFalse(snapshot(0).isDemo)
    }

    func testOnlyANewerReadingOrAnotherSiteReplacesTheStoredOne() {
        let stored = snapshot(5, 140)
        XCTAssertTrue(GlucoseSnapshot.shouldReplace(nil, with: stored))
        XCTAssertTrue(GlucoseSnapshot.shouldReplace(stored, with: snapshot(0, 150)))
        XCTAssertFalse(GlucoseSnapshot.shouldReplace(stored, with: snapshot(10, 130)), "a late fetch never wins")
        XCTAssertFalse(GlucoseSnapshot.shouldReplace(stored, with: stored), "nothing to write")
        XCTAssertTrue(GlucoseSnapshot.shouldReplace(stored, with: snapshot(5, 140, previous: reading(10, 135))))
        XCTAssertTrue(GlucoseSnapshot.shouldReplace(stored, with: snapshot(10, 130, site: "https://other.example.org")))
    }
}

final class WidgetTimelineTests: XCTestCase {
    func testNoReadingYetIsOneEmptyEntryAndALaterLook() {
        let plan = WidgetTimeline.make(nil, now: noon)
        XCTAssertEqual(plan.entries, [WidgetEntry(date: noon, state: nil, isStale: false)])
        XCTAssertEqual(plan.refreshAt, noon.addingTimeInterval(15 * 60))
    }

    func testAFreshReadingGoesGreyAtFifteenMinutesByItself() {
        let plan = WidgetTimeline.make(snapshot(2, 151, previous: reading(7, 145)), now: noon)
        let state = LiveGlucoseState(mgdl: 151, direction: "Flat", delta: 6, readingAt: noon.addingTimeInterval(-120))
        XCTAssertEqual(plan.entries, [
            WidgetEntry(date: noon, state: state, isStale: false),
            WidgetEntry(date: noon.addingTimeInterval(13 * 60), state: state, isStale: true),
        ])
        XCTAssertEqual(plan.entries[1].date, state.staleDate, "the same moment the Live Activity goes stale")
    }

    func testAnOldReadingIsGreyFromTheStart() {
        let plan = WidgetTimeline.make(snapshot(15), now: noon)
        XCTAssertEqual(plan.entries.count, 1)
        XCTAssertTrue(plan.entries[0].isStale)
        XCTAssertEqual(WidgetTimeline.make(snapshot(40), now: noon).entries.map(\.isStale), [true])
        XCTAssertEqual(WidgetTimeline.make(snapshot(14.9), now: noon).entries.map(\.isStale), [false, true])
    }

    func testAsksAgainJustAfterTheNextReadingIsDue() {
        // Readings come every five minutes; give the uploader a minute.
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(2, 0).at, now: noon), noon.addingTimeInterval(4 * 60))
        XCTAssertEqual(WidgetTimeline.make(snapshot(0), now: noon).refreshAt, noon.addingTimeInterval(6 * 60))
    }

    func testBacksOffWhileNoNewReadingComes() {
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(5.5, 0).at, now: noon), noon.addingTimeInterval(60), "never sooner than a minute")
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(7, 0).at, now: noon), noon.addingTimeInterval(5 * 60))
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(19, 0).at, now: noon), noon.addingTimeInterval(5 * 60))
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(20, 0).at, now: noon), noon.addingTimeInterval(15 * 60))
        XCTAssertEqual(WidgetTimeline.nextRefresh(readingAt: reading(600, 0).at, now: noon), noon.addingTimeInterval(15 * 60))
    }

    func testAReadingFromTheFutureIsNotStale() {
        let plan = WidgetTimeline.make(snapshot(-1), now: noon)
        XCTAssertEqual(plan.entries.map(\.isStale), [false, true])
        XCTAssertEqual(plan.entries[1].date, noon.addingTimeInterval(16 * 60))
    }

    func testTheDemoMovesEveryFiveMinutesForAnHour() {
        let now = noon.addingTimeInterval(130)
        let plan = WidgetTimeline.demo(now: now)
        XCTAssertEqual(plan.entries.count, 12)
        XCTAssertEqual(plan.entries[0].date, now, "the first entry is for now, with the reading at or before it")
        XCTAssertEqual(plan.entries[0].state?.readingAt, noon)
        for (index, entry) in plan.entries.enumerated() {
            let mark = noon.addingTimeInterval(Double(index) * 300)
            let pair = DemoCurve.latest(now: mark, count: 2)
            XCTAssertEqual(entry.state, LiveGlucoseState(current: pair[0], previous: pair[1]))
            XCTAssertFalse(entry.isStale)
            if index > 0 { XCTAssertEqual(entry.date, mark) }
        }
        XCTAssertEqual(plan.refreshAt, noon.addingTimeInterval(12 * 300))
    }
}

final class WidgetFeedTests: XCTestCase {
    func testTheDemoNeedsNoNetwork() {
        XCTAssertEqual(WidgetTimeline.feed(source: .demo, snapshot: nil, now: noon), .demo)
        XCTAssertEqual(WidgetTimeline.feed(source: nil, snapshot: snapshot(0, site: DemoCurve.siteMarker), now: noon), .demo)
    }

    func testReadsTheSiteOnlyWhenTheNextReadingIsDue() {
        XCTAssertEqual(WidgetTimeline.feed(source: source, snapshot: nil, now: noon), .fetch(source))
        XCTAssertEqual(WidgetTimeline.feed(source: source, snapshot: snapshot(4), now: noon), .stored)
        XCTAssertEqual(WidgetTimeline.feed(source: source, snapshot: snapshot(5), now: noon), .fetch(source))
        XCTAssertEqual(WidgetTimeline.feed(source: source, snapshot: snapshot(4, site: "https://other.example.org"), now: noon), .fetch(source),
                       "another site's snapshot does not count")
    }

    func testWithoutTheCredentialTheSnapshotIsAllThereIs() {
        // Before the app has shared the credential with the extension, or before the first unlock.
        XCTAssertEqual(WidgetTimeline.feed(source: nil, snapshot: snapshot(30), now: noon), .stored)
        XCTAssertEqual(WidgetTimeline.feed(source: nil, snapshot: nil, now: noon), .stored)
    }

    func testOnlyTheFollowedSitesSnapshotIsShown() {
        let other = snapshot(1, site: "https://other.example.org")
        XCTAssertNil(WidgetTimeline.usable(other, for: source))
        XCTAssertNil(WidgetTimeline.usable(snapshot(1, site: DemoCurve.siteMarker), for: source))
        XCTAssertEqual(WidgetTimeline.usable(snapshot(1), for: source), snapshot(1))
        XCTAssertEqual(WidgetTimeline.usable(other, for: nil), other)
    }

    func testAnAnswerForASiteNoLongerFollowedIsDropped() {
        let fetched = [reading(1, 150)]
        // "Remove this phone" while the widget waited: the Keychain and the snapshot are gone.
        let removed = WidgetTimeline.afterFetch(asked: source, fetched: fetched, source: nil, stored: nil)
        XCTAssertNil(removed.show)
        XCTAssertFalse(removed.store)
        // Switched to another site, whose reading the app already stored.
        let other = FollowSource.nightscout(site: URL(string: "https://other.example.org")!, token: "fixture-token")
        let otherSnapshot = snapshot(3, 120, site: "https://other.example.org")
        let switched = WidgetTimeline.afterFetch(asked: source, fetched: fetched, source: other, stored: otherSnapshot)
        XCTAssertEqual(switched.show, otherSnapshot)
        XCTAssertFalse(switched.store)
        // Switched to the demo.
        XCTAssertFalse(WidgetTimeline.afterFetch(asked: source, fetched: fetched, source: .demo, stored: nil).store)
    }

    func testANewerReadingTheAppStoredMeanwhileWins() {
        let newer = snapshot(0, 160)
        let result = WidgetTimeline.afterFetch(asked: source, fetched: [reading(1, 150)], source: source, stored: newer)
        XCTAssertEqual(result.show, newer)
        XCTAssertFalse(result.store)
        let fresh = WidgetTimeline.afterFetch(asked: source, fetched: [reading(1, 150)], source: source, stored: snapshot(6, 140))
        XCTAssertEqual(fresh.show, snapshot(1, 150))
        XCTAssertTrue(fresh.store)
        let failed = WidgetTimeline.afterFetch(asked: source, fetched: [], source: source, stored: snapshot(6, 140))
        XCTAssertEqual(failed.show, snapshot(6, 140))
        XCTAssertFalse(failed.store)
    }

    func testTheNewerOfStoredAndFetchedWins() {
        let stored = snapshot(6, 140)
        let fetched = [reading(1, 150), reading(6, 140)]
        XCTAssertEqual(WidgetTimeline.merge(stored, fetched: fetched, site: site), snapshot(1, 150, previous: reading(6, 140)))
        XCTAssertEqual(WidgetTimeline.merge(stored, fetched: [reading(11, 120)], site: site), stored, "an older answer never wins")
        XCTAssertEqual(WidgetTimeline.merge(stored, fetched: [], site: site), stored)
        XCTAssertNil(WidgetTimeline.merge(nil, fetched: [], site: site))
    }
}
