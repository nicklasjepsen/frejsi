import Foundation
import XCTest
@testable import FollowCore

final class ThresholdsTests: XCTestCase {
    let t = GlucoseThresholds.nightscoutDefaults
    let now = Date(timeIntervalSince1970: 1_793_016_000)

    func testDefaultsAreNightscouts() {
        XCTAssertEqual(t, GlucoseThresholds(urgentLowMgdl: 55, lowMgdl: 80, highMgdl: 180, urgentHighMgdl: 260))
        XCTAssertTrue(t.isValid)
        let en = Locale(identifier: "en_GB")
        XCTAssertEqual(GlucoseThresholds.Kind.allCases.map { t.formatted($0, unit: .mmolL, locale: en) }, ["3.1", "4.4", "10.0", "14.4"])
        XCTAssertEqual(GlucoseThresholds.Kind.allCases.map { t.formatted($0, unit: .mgdL, locale: en) }, ["55", "80", "180", "260"])
    }

    func testBandBoundaries() {
        XCTAssertEqual(Glucose.band(40, thresholds: t), .urgentLow)
        XCTAssertEqual(Glucose.band(55, thresholds: t), .urgentLow, "at the urgent value is red")
        XCTAssertEqual(Glucose.band(56, thresholds: t), .low)
        XCTAssertEqual(Glucose.band(79, thresholds: t), .low)
        XCTAssertEqual(Glucose.band(80, thresholds: t), .inRange, "low itself is green")
        XCTAssertEqual(Glucose.band(180, thresholds: t), .inRange, "high itself is green")
        XCTAssertEqual(Glucose.band(181, thresholds: t), .high)
        XCTAssertEqual(Glucose.band(259, thresholds: t), .high)
        XCTAssertEqual(Glucose.band(260, thresholds: t), .urgentHigh, "at the urgent value is red")
        XCTAssertEqual(Glucose.band(400, thresholds: t), .urgentHigh)
    }

    func testColours() {
        XCTAssertEqual(Glucose.color(55, thresholds: t, isStale: false), .red)
        XCTAssertEqual(Glucose.color(70, thresholds: t, isStale: false), .yellow)
        XCTAssertEqual(Glucose.color(120, thresholds: t, isStale: false), .green)
        XCTAssertEqual(Glucose.color(200, thresholds: t, isStale: false), .yellow)
        XCTAssertEqual(Glucose.color(300, thresholds: t, isStale: false), .red)
    }

    func testStaleOverridesEveryColour() {
        for mgdl in [40, 70, 120, 200, 300] {
            XCTAssertEqual(Glucose.color(mgdl, thresholds: t, isStale: true), .stale)
        }
        let fresh = Reading(at: now.addingTimeInterval(-14 * 60), mgdl: 300, direction: "Flat")
        let old = Reading(at: now.addingTimeInterval(-16 * 60), mgdl: 300, direction: "Flat")
        XCTAssertEqual(Glucose.color(fresh, thresholds: t, now: now), .red)
        XCTAssertEqual(Glucose.color(old, thresholds: t, now: now), .stale)
    }

    func testSteppingInMmolMovesByOneTenthAndStaysInOrder() {
        let up = t.stepped(.low, by: 1, unit: .mmolL)
        XCTAssertEqual(Glucose.toMmolL(up.lowMgdl), 4.5)
        let down = t.stepped(.high, by: -1, unit: .mmolL)
        XCTAssertEqual(Glucose.toMmolL(down.highMgdl), 9.9)
        // Many steps never pass a neighbour.
        let squeezed = t.stepped(.low, by: 200, unit: .mmolL)
        XCTAssertEqual(squeezed.lowMgdl, t.highMgdl - 1)
        XCTAssertTrue(squeezed.isValid)
        let floor = t.stepped(.urgentLow, by: -200, unit: .mmolL)
        XCTAssertEqual(floor.urgentLowMgdl, GlucoseThresholds.minMgdl)
    }

    func testSteppingInMgdlMovesByOne() {
        XCTAssertEqual(t.stepped(.urgentHigh, by: 1, unit: .mgdL).urgentHighMgdl, 261)
        XCTAssertEqual(t.stepped(.urgentHigh, by: 1000, unit: .mgdL).urgentHighMgdl, GlucoseThresholds.maxMgdl)
        XCTAssertEqual(t.stepped(.high, by: -1000, unit: .mgdL).highMgdl, t.lowMgdl + 1)
    }

    func testMmolThresholdsConvertToMgdl() {
        // A user who sets 3.0 / 4.0 / 10.0 / 13.9 mmol/L.
        var custom = t
        custom.urgentLowMgdl = Glucose.toMgdl(3.0)
        custom.lowMgdl = Glucose.toMgdl(4.0)
        custom.highMgdl = Glucose.toMgdl(10.0)
        custom.urgentHighMgdl = Glucose.toMgdl(13.9)
        XCTAssertEqual(custom, GlucoseThresholds(urgentLowMgdl: 54, lowMgdl: 72, highMgdl: 180, urgentHighMgdl: 250))
        XCTAssertEqual(Glucose.band(Glucose.toMgdl(3.9), thresholds: custom), .low)
        XCTAssertEqual(Glucose.band(Glucose.toMgdl(4.0), thresholds: custom), .inRange)
    }

    func testReadsNightscoutStatus() throws {
        let mgdl = #"{"status":"ok","settings":{"units":"mmol","thresholds":{"bgHigh":250,"bgTargetTop":170,"bgTargetBottom":70,"bgLow":54}}}"#
        XCTAssertEqual(
            GlucoseThresholds.fromNightscoutStatus(Data(mgdl.utf8)),
            GlucoseThresholds(urgentLowMgdl: 54, lowMgdl: 70, highMgdl: 170, urgentHighMgdl: 250)
        )
        let mmol = #"{"settings":{"thresholds":{"bgHigh":14.4,"bgTargetTop":10,"bgTargetBottom":4.4,"bgLow":3.1}}}"#
        XCTAssertEqual(
            GlucoseThresholds.fromNightscoutStatus(Data(mmol.utf8)),
            GlucoseThresholds(urgentLowMgdl: 56, lowMgdl: 79, highMgdl: 180, urgentHighMgdl: 259)
        )
        for bad in [
            #"{"settings":{}}"#,
            #"{"settings":{"thresholds":{"bgHigh":260,"bgTargetTop":180,"bgTargetBottom":80}}}"#,
            #"{"settings":{"thresholds":{"bgHigh":100,"bgTargetTop":180,"bgTargetBottom":80,"bgLow":55}}}"#,
            #"{"settings":{"thresholds":{"bgHigh":"260","bgTargetTop":180,"bgTargetBottom":80,"bgLow":55}}}"#,
            "[]", "nonsense",
        ] {
            XCTAssertNil(GlucoseThresholds.fromNightscoutStatus(Data(bad.utf8)), bad)
        }
    }

    func testThresholdsRoundTripAsJSON() throws {
        let data = try JSONEncoder().encode(t)
        XCTAssertEqual(try JSONDecoder().decode(GlucoseThresholds.self, from: data), t)
    }
}
