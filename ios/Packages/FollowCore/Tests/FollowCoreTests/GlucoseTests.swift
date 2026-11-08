import Foundation
import XCTest
@testable import FollowCore

/// The same cases as `desktop/tests/BgTray.Core.Tests/GlucoseTests.cs`.
final class GlucoseTests: XCTestCase {
    let da = Locale(identifier: "da_DK")
    let en = Locale(identifier: "en_US_POSIX")
    let now = Date(timeIntervalSince1970: 1_793_016_000)

    func testConvertsMgdlToMmolL() {
        XCTAssertEqual(Glucose.toMmolL(180), 10.0)
        XCTAssertEqual(Glucose.toMmolL(70), 3.9)
        XCTAssertEqual(Glucose.toMmolL(151), 8.4)
        XCTAssertEqual(Glucose.toMmolL(39), 2.2)
        XCTAssertEqual(Glucose.toMgdl(10.0), 180)
        XCTAssertEqual(Glucose.toMgdl(3.9), 70)
    }

    func testFormatsWithTheLocalesSeparator() {
        XCTAssertEqual(Glucose.format(151, unit: .mmolL, locale: da), "8,4")
        XCTAssertEqual(Glucose.format(151, unit: .mmolL, locale: en), "8.4")
        XCTAssertEqual(Glucose.format(180, unit: .mmolL, locale: en), "10.0")
        XCTAssertEqual(Glucose.format(151, unit: .mgdL, locale: da), "151")
    }

    func testDeltaIsSignedAndNilWhenTheReadingsAreTooFarApart() {
        let current = Reading(at: now, mgdl: 151, direction: "Flat")
        let fiveMinAgo = Reading(at: now.addingTimeInterval(-300), mgdl: 145, direction: "Flat")
        let anHourAgo = Reading(at: now.addingTimeInterval(-3600), mgdl: 145, direction: "Flat")
        var tenMinAgo = current
        tenMinAgo.at = now.addingTimeInterval(-600)

        XCTAssertEqual(Glucose.formatDelta(current, previous: fiveMinAgo, unit: .mmolL, locale: en), "+0.3")
        XCTAssertEqual(Glucose.formatDelta(fiveMinAgo, previous: tenMinAgo, unit: .mmolL, locale: en), "−0.3")
        XCTAssertEqual(Glucose.formatDelta(fiveMinAgo, previous: tenMinAgo, unit: .mmolL, locale: da), "−0,3")
        XCTAssertEqual(Glucose.formatDelta(current, previous: fiveMinAgo, unit: .mgdL, locale: en), "+6")
        XCTAssertNil(Glucose.formatDelta(current, previous: anHourAgo, unit: .mmolL, locale: en))
        XCTAssertNil(Glucose.formatDelta(current, previous: nil, unit: .mmolL, locale: en))
        XCTAssertEqual(Glucose.deltaMgdl(current, previous: fiveMinAgo), 6)
        XCTAssertNil(Glucose.deltaMgdl(current, previous: anHourAgo))
        XCTAssertNil(Glucose.deltaMgdl(fiveMinAgo, previous: current), "a previous reading from the future")
        // The Live Activity's delta formats exactly like the two readings it came from.
        XCTAssertEqual(Glucose.formatDelta(mgdl: 151, deltaMgdl: 6, unit: .mmolL, locale: en), "+0.3")
        XCTAssertEqual(Glucose.formatDelta(mgdl: 145, deltaMgdl: -6, unit: .mmolL, locale: da), "−0,3")
        XCTAssertEqual(Glucose.formatDelta(mgdl: 151, deltaMgdl: 0, unit: .mgdL, locale: en), "+0")
    }

    func testArrowsFollowNightscoutDirections() {
        XCTAssertEqual(Glucose.arrow("Flat"), "→")
        XCTAssertEqual(Glucose.arrow("FortyFiveUp"), "↗")
        XCTAssertEqual(Glucose.arrow("DoubleDown"), "⇊")
        XCTAssertEqual(Glucose.arrow("SingleUp"), "↑")
        XCTAssertEqual(Glucose.arrow("NOT COMPUTABLE"), "")
        XCTAssertEqual(Glucose.arrow(nil), "")
    }

    func testClassifiesAgainstMmolThresholds() {
        XCTAssertEqual(Glucose.classify(69, lowMmolL: 3.9, highMmolL: 10.0), .low)
        XCTAssertEqual(Glucose.classify(70, lowMmolL: 3.9, highMmolL: 10.0), .inRange)
        XCTAssertEqual(Glucose.classify(180, lowMmolL: 3.9, highMmolL: 10.0), .inRange)
        XCTAssertEqual(Glucose.classify(182, lowMmolL: 3.9, highMmolL: 10.0), .high)
    }

    func testStaleAfterFifteenMinutes() {
        XCTAssertFalse(Glucose.isStale(Reading(at: now.addingTimeInterval(-14 * 60), mgdl: 100, direction: "Flat"), now: now))
        XCTAssertTrue(Glucose.isStale(Reading(at: now.addingTimeInterval(-16 * 60), mgdl: 100, direction: "Flat"), now: now))
        let reading = Reading(at: now, mgdl: 100, direction: "Flat")
        XCTAssertEqual(Glucose.staleDate(for: reading), now.addingTimeInterval(15 * 60))
    }

    func testAgeTextReadsLikeAPerson() {
        let cases: [(Int, String, String)] = [
            (0, "just now", "lige nu"),
            (3, "3 min ago", "3 min siden"),
            (59, "59 min ago", "59 min siden"),
            (60, "1 h ago", "1 t siden"),
            (26 * 60, "yesterday", "i går"),
            (3 * 24 * 60, "3 days ago", "3 dage siden"),
            (-2, "just now", "lige nu"),
        ]
        for (minutesAgo, english, danish) in cases {
            let reading = Reading(at: now.addingTimeInterval(TimeInterval(-minutesAgo * 60)), mgdl: 100, direction: "Flat")
            XCTAssertEqual(Glucose.ageText(reading, now: now, language: .en), english)
            XCTAssertEqual(Glucose.ageText(reading, now: now, language: .da), danish)
        }
    }

    func testLanguageFollowsTheLocale() {
        XCTAssertEqual(Language(localeIdentifier: "da_DK"), .da)
        XCTAssertEqual(Language(localeIdentifier: "da"), .da)
        XCTAssertEqual(Language(localeIdentifier: "en_GB"), .en)
        XCTAssertEqual(Language(localeIdentifier: "de_DE"), .en)
    }

    func testTheAppsLanguageIsTheFirstPreferredOneItSpeaks() {
        XCTAssertEqual(Language.preferred(["da-DK", "en-GB"]), .da)
        XCTAssertEqual(Language.preferred(["en-DK", "da-DK"]), .en)
        XCTAssertEqual(Language.preferred(["de-DE", "da"]), .da)
        XCTAssertEqual(Language.preferred(["de-DE", "fr-FR"]), .en)
        XCTAssertEqual(Language.preferred([]), .en)
        XCTAssertEqual(Language.da.localeIdentifier, "da_DK")
        XCTAssertEqual(Language.en.agoSuffix, "ago")
        XCTAssertEqual(Language.da.agoSuffix, "siden")
        // Numbers follow the same language: the app and the lock screen show "8,4" or "8.4" alike.
        XCTAssertEqual(Glucose.format(151, unit: .mmolL, locale: Locale(identifier: Language.da.localeIdentifier)), "8,4")
        XCTAssertEqual(Glucose.format(151, unit: .mmolL, locale: Locale(identifier: Language.en.localeIdentifier)), "8.4")
    }
}
