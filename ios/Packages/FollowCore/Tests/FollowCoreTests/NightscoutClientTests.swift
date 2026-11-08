import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import FollowCore

func fixture(_ name: String) throws -> Data {
    let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

/// Records the one request and answers a canned status and body.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    let status: Int
    let body: Data
    let failure: NightscoutError?
    private(set) var requests: [URLRequest] = []

    init(status: Int = 200, body: Data = Data(), failure: NightscoutError? = nil) {
        self.status = status
        self.body = body
        self.failure = failure
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        if let failure { throw failure }
        return (body, status)
    }
}

/// The same cases as `desktop/tests/BgTray.Core.Tests/NightscoutClientTests.cs`.
final class NightscoutClientTests: XCTestCase {
    func testParsesEntriesNewestFirst() throws {
        let readings = try NightscoutClient.parseEntries(fixture("entries-sgv"))
        XCTAssertEqual(readings.count, 2)
        XCTAssertEqual(readings[0].mgdl, 151)
        XCTAssertEqual(readings[0].direction, "FortyFiveUp")
        XCTAssertEqual(readings[0].at, Date(timeIntervalSince1970: 1_793_016_000))
        XCTAssertEqual(readings[1].mgdl, 145)
    }

    func testSortsWhateverOrderTheSiteUses() throws {
        let json = #"[{"sgv":100,"date":1000},{"sgv":120,"date":3000},{"sgv":110,"date":2000}]"#
        let readings = try NightscoutClient.parseEntries(Data(json.utf8))
        XCTAssertEqual(readings.map(\.mgdl), [120, 110, 100])
    }

    func testSkipsEntriesWithoutAValue() throws {
        let json = #"[{"sgv":0,"date":1},{"mbg":120,"date":2},{"sgv":99,"date":3},{"sgv":"88","date":4},{"sgv":true,"date":5},"x"]"#
        let readings = try NightscoutClient.parseEntries(Data(json.utf8))
        XCTAssertEqual(readings.count, 1)
        XCTAssertEqual(readings[0].mgdl, 99)
        XCTAssertEqual(readings[0].direction, "")
    }

    func testSkipsOutOfRangeValuesWithoutTrapping() throws {
        let json = #"[{"sgv":1e100,"date":4},{"sgv":721,"date":3},{"sgv":100,"date":1e300},{"sgv":720,"date":2}]"#
        let readings = try NightscoutClient.parseEntries(Data(json.utf8))
        XCTAssertEqual(readings.map(\.mgdl), [720])
    }

    func testKeepsOneReadingPerTimestamp() throws {
        let json = #"[{"sgv":151,"date":3000},{"sgv":151,"date":3000},{"sgv":145,"date":2000}]"#
        let readings = try NightscoutClient.parseEntries(Data(json.utf8))
        XCTAssertEqual(readings.map(\.mgdl), [151, 145])
    }

    func testRefusesSomethingThatIsNotEntries() {
        for body in ["not json", #"{"status":"ok"}"#, "42"] {
            XCTAssertThrowsError(try NightscoutClient.parseEntries(Data(body.utf8))) { error in
                XCTAssertEqual(error as? NightscoutError, .notNightscout)
            }
        }
    }

    func testNormalizesTheSiteAddress() throws {
        XCTAssertEqual(try NightscoutClient.normalizeBaseURL("ns.example.org").absoluteString, "https://ns.example.org")
        XCTAssertEqual(try NightscoutClient.normalizeBaseURL("https://ns.example.org/").absoluteString, "https://ns.example.org")
        XCTAssertEqual(
            try NightscoutClient.normalizeBaseURL("  https://ns.example.org/some/path/ ").absoluteString,
            "https://ns.example.org/some/path"
        )
    }

    func testRefusesPlainHttpAndNonsense() {
        XCTAssertThrowsError(try NightscoutClient.normalizeBaseURL("http://ns.example.org")) {
            XCTAssertEqual($0 as? NightscoutError, .notHTTPS)
        }
        for text in ["", "   ", "https://", "https://ns.example.org/?token=x"] {
            XCTAssertThrowsError(try NightscoutClient.normalizeBaseURL(text), text) {
                XCTAssertEqual($0 as? NightscoutError, .invalidAddress, text)
            }
        }
    }

    func testSendsTheTokenInTheApiSecretHeaderAndReadsOnlyEntries() async throws {
        let transport = StubTransport(body: try fixture("entries-sgv"))
        let client = NightscoutClient(transport: transport)
        let readings = try await client.latest(site: "https://ns.example.org", token: " tok-123 ")
        XCTAssertEqual(readings.count, 2)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://ns.example.org/api/v1/entries/sgv.json?count=2")
        XCTAssertEqual(request.value(forHTTPHeaderField: "api-secret"), "tok-123")
        XCTAssertNil(request.httpBody)
        XCTAssertFalse(request.url!.absoluteString.contains("tok-123"), "the token never goes in the URL")
    }

    func testKeepsASitePathAndTheCount() async throws {
        let transport = StubTransport(body: Data("[]".utf8))
        _ = try await NightscoutClient(transport: transport).latest(site: "ns.example.org/sub", token: "", count: 36)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://ns.example.org/sub/api/v1/entries/sgv.json?count=36")
        XCTAssertNil(request.value(forHTTPHeaderField: "api-secret"))
    }

    func testReadsTheSitesThresholdsFromStatusOnly() async throws {
        let body = #"{"settings":{"thresholds":{"bgHigh":250,"bgTargetTop":170,"bgTargetBottom":70,"bgLow":54}}}"#
        let transport = StubTransport(body: Data(body.utf8))
        let thresholds = try await NightscoutClient(transport: transport).thresholds(site: "ns.example.org", token: "tok")
        XCTAssertEqual(thresholds, GlucoseThresholds(urgentLowMgdl: 54, lowMgdl: 70, highMgdl: 170, urgentHighMgdl: 250))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://ns.example.org/api/v1/status.json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "api-secret"), "tok")
        let none = try await NightscoutClient(transport: StubTransport(body: Data("{}".utf8))).thresholds(site: "ns.example.org", token: "tok")
        XCTAssertNil(none)
    }

    func testExplainsRefusalsInPlainWords() async {
        let cases: [(Int, NightscoutError, String)] = [
            (401, .tokenRefused, "token was refused"),
            (403, .tokenRefused, "token was refused"),
            (500, .status(500), "answered 500"),
        ]
        for (status, expected, fragment) in cases {
            let client = NightscoutClient(transport: StubTransport(status: status))
            do {
                _ = try await client.latest(site: "https://ns.example.org", token: "x")
                XCTFail("expected \(expected)")
            } catch let error as NightscoutError {
                XCTAssertEqual(error, expected)
                XCTAssertTrue(error.message.contains(fragment), error.message)
            } catch {
                XCTFail("unexpected \(error)")
            }
        }
    }

    func testPassesTransportFailuresThrough() async {
        let client = NightscoutClient(transport: StubTransport(failure: .timedOut))
        do {
            _ = try await client.latest(site: "https://ns.example.org", token: "x")
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual(error as? NightscoutError, .timedOut)
        }
    }

    func testErrorMessagesNeverCarryTheAddressOrToken() {
        let all: [NightscoutError] = [.invalidAddress, .notHTTPS, .unreachable, .timedOut, .tokenRefused, .status(502), .notNightscout]
        for error in all {
            XCTAssertFalse(error.message.contains("example"))
            XCTAssertFalse(error.message.contains("tok-"))
            XCTAssertFalse(error.message(in: .da).isEmpty)
            XCTAssertNotEqual(error.message(in: .da), error.message(in: .en))
        }
        XCTAssertEqual(NightscoutError.status(502).message(in: .da), "Siden svarede 502")
    }
}
