import Foundation
import XCTest
@testable import FollowCore

final class FollowLinkTests: XCTestCase {
    func testRoundTripsSiteAndToken() throws {
        let link = FollowLink(site: try NightscoutClient.normalizeBaseURL("ns.example.org"), token: "fixture-token")
        let url = link.url()
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "naensom.jepsen.ninja")
        XCTAssertEqual(url.path, "/follow")
        XCTAssertNil(url.query, "nothing in the query: a server would log it")
        XCTAssertEqual(FollowLink.parse(url), link)
    }

    func testTheFragmentIsBase64urlJson() throws {
        let link = FollowLink(site: try NightscoutClient.normalizeBaseURL("https://ns.example.org/"), token: "tok?/+")
        let fragment = try XCTUnwrap(link.url().fragment)
        XCTAssertFalse(fragment.contains("="))
        XCTAssertFalse(fragment.contains("+"))
        XCTAssertFalse(fragment.contains("/"))
        let json = try XCTUnwrap(FollowLink.fromBase64url(fragment))
        XCTAssertEqual(String(decoding: json, as: UTF8.self), #"{"token":"tok?/+","url":"https://ns.example.org"}"#)
    }

    func testReadsALinkMadeElsewhere() throws {
        // What the web page or a script makes: base64url without padding of {"url","token"}.
        let json = #"{"url":"ns.example.org/","token":"  abc  "}"#
        let fragment = FollowLink.base64url(Data(json.utf8))
        let url = try XCTUnwrap(URL(string: "https://naensom.jepsen.ninja/follow#\(fragment)"))
        let link = try XCTUnwrap(FollowLink.parse(url))
        XCTAssertEqual(link.site.absoluteString, "https://ns.example.org")
        XCTAssertEqual(link.token, "abc")
    }

    func testRefusesAnythingElse() throws {
        let good = FollowLink(site: try NightscoutClient.normalizeBaseURL("ns.example.org"), token: "abc").url().fragment!
        let empty = FollowLink.base64url(Data(#"{"url":"ns.example.org","token":" "}"#.utf8))
        let plainHttp = FollowLink.base64url(Data(#"{"url":"http://ns.example.org","token":"abc"}"#.utf8))
        for text in [
            "https://evil.example.org/follow#\(good)",
            "http://naensom.jepsen.ninja/follow#\(good)",
            "https://naensom.jepsen.ninja/other#\(good)",
            "https://naensom.jepsen.ninja/follow",
            "https://naensom.jepsen.ninja/follow#not-base64-json",
            "https://naensom.jepsen.ninja/follow#\(empty)",
            "https://naensom.jepsen.ninja/follow#\(plainHttp)",
        ] {
            XCTAssertNil(FollowLink.parse(try XCTUnwrap(URL(string: text))), text)
        }
    }
}

final class LiveGlucoseStateTests: XCTestCase {
    let at = Date(timeIntervalSince1970: 1_793_016_000)

    /// The fixture is the contract with the relay: `poller/src/live/` reads the same file.
    func testMatchesTheSharedFixture() throws {
        let decoded = try JSONDecoder().decode(LiveGlucoseState.self, from: fixture("content-state"))
        XCTAssertEqual(decoded, LiveGlucoseState(mgdl: 151, direction: "FortyFiveUp", delta: 6, readingAt: at))

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let encoded = String(decoding: try encoder.encode(decoded), as: UTF8.self)
        let expected = String(decoding: try fixture("content-state"), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertEqual(encoded, expected)
    }

    func testReadingAtIsUnixSecondsWhateverTheDecodersDateStrategy() throws {
        // ActivityKit's decoder uses the default strategy (seconds since 2001); ours must not care.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        let state = try decoder.decode(LiveGlucoseState.self, from: Data(#"{"mgdl":90,"readingAt":1793016000.5}"#.utf8))
        XCTAssertEqual(state.readingAt.timeIntervalSince1970, 1_793_016_000.5)
        XCTAssertEqual(state.direction, "")
        XCTAssertNil(state.delta)
    }

    func testBuildsFromReadingsWithStaleDate() {
        let current = Reading(at: at, mgdl: 151, direction: "FortyFiveUp")
        let previous = Reading(at: at.addingTimeInterval(-300), mgdl: 145, direction: "Flat")
        let state = LiveGlucoseState(current: current, previous: previous)
        XCTAssertEqual(state.delta, 6)
        XCTAssertEqual(state.reading, current)
        XCTAssertEqual(state.staleDate, at.addingTimeInterval(900))
        XCTAssertNil(LiveGlucoseState(current: current, previous: nil).delta)
    }
}
