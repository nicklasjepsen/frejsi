import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Nænsom's push relay (plan §4): the server that keeps the Live Activity current with the app
/// closed and sends the low/high reminders.
public enum RelayConfig {
    public static let baseURL = URL(string: "https://frejsi-poller-cniydvxtxktqa.azurewebsites.net/api")!
    public static let registerPath = "/live/register"
}

/// Which APNs host the relay pushes through: the sandbox for Debug builds, production for TestFlight
/// and the App Store.
public enum APNsEnvironment: String, Codable, Sendable {
    case sandbox
    case production
}

/// What the relay needs to identify this phone again: kept in the Keychain.
public struct RelayCredentials: Codable, Equatable, Sendable {
    public var subscriptionId: String
    public var deviceSecret: String

    public init(subscriptionId: String, deviceSecret: String) {
        self.subscriptionId = subscriptionId
        self.deviceSecret = deviceSecret
    }
}

/// The push tokens the app has collected.
public struct LivePushTokens: Equatable, Sendable {
    /// Per install: lets the relay start a new activity with the app closed (the 8-hour restart).
    public var pushToStart: String?
    /// Per activity: where `update` and `end` pushes go.
    public var activity: String?
    /// When the app started or first saw the current activity.
    public var activityStartedAt: Date?
    /// The app's APNs device token, for the low/high reminders.
    public var device: String?

    public init(pushToStart: String? = nil, activity: String? = nil, activityStartedAt: Date? = nil, device: String? = nil) {
        self.pushToStart = pushToStart
        self.activity = activity
        self.activityStartedAt = activityStartedAt
        self.device = device
    }
}

/// The body of `POST /api/live/register`, as the contract with `poller/src/live/` spells it.
public struct RelayRegistration: Equatable, Sendable {
    public var nightscoutUrl: String
    public var nightscoutToken: String?
    public var pushToStartToken: String?
    public var activityPushToken: String?
    public var activityStartedAt: Date?
    public var deviceToken: String?
    public var apnsEnvironment: APNsEnvironment
    public var unit: GlucoseUnit
    public var thresholds: GlucoseThresholds
    public var alertsOn: Bool
    public var language: Language

    public init(
        nightscoutUrl: String, nightscoutToken: String?, pushToStartToken: String?, activityPushToken: String?,
        activityStartedAt: Date?, deviceToken: String?, apnsEnvironment: APNsEnvironment, unit: GlucoseUnit,
        thresholds: GlucoseThresholds, alertsOn: Bool, language: Language
    ) {
        self.nightscoutUrl = nightscoutUrl
        self.nightscoutToken = nightscoutToken
        self.pushToStartToken = pushToStartToken
        self.activityPushToken = activityPushToken
        self.activityStartedAt = activityStartedAt
        self.deviceToken = deviceToken
        self.apnsEnvironment = apnsEnvironment
        self.unit = unit
        self.thresholds = thresholds
        self.alertsOn = alertsOn
        self.language = language
    }

    /// The registration for the app's current state. With the Live Activity off the relay gets no
    /// activity tokens, so it can neither update nor restart one; with reminders off it gets no
    /// device token.
    public static func make(
        source: FollowSource, settings: FollowSettings, thresholds: GlucoseThresholds, tokens: LivePushTokens,
        language: Language, environment: APNsEnvironment
    ) -> RelayRegistration {
        let live = settings.liveActivityOn
        return RelayRegistration(
            nightscoutUrl: source.relayURL,
            nightscoutToken: source.relayToken,
            pushToStartToken: live ? tokens.pushToStart : nil,
            activityPushToken: live ? tokens.activity : nil,
            activityStartedAt: live && tokens.activity != nil ? tokens.activityStartedAt : nil,
            deviceToken: settings.alertsOn ? tokens.device : nil,
            apnsEnvironment: environment,
            unit: settings.unit,
            thresholds: thresholds,
            alertsOn: settings.alertsOn,
            language: language
        )
    }
}

/// What went wrong talking to the relay. Never carries the address, a token or a value.
public enum RelayError: Error, Equatable, Sendable {
    case unreachable
    case validation
    case notHTTPS
    case badDeviceSecret
    case nightscoutRefused
    case nightscoutUnreachable
    case rateLimited
    case status(Int)
    case badResponse
}

/// Registers this phone with the relay, keeps the registration current, and removes it.
public struct RelayClient: Sendable {
    private let transport: HTTPTransport
    private let baseURL: URL

    public init(transport: HTTPTransport, baseURL: URL = RelayConfig.baseURL) {
        self.transport = transport
        self.baseURL = baseURL
    }

    /// Creates the subscription, or updates it when there are credentials. An update the relay no
    /// longer recognises (wrong secret, or the subscription is gone) becomes a new subscription, so
    /// a phone the relay forgot registers again by itself. Answers the credentials to keep.
    public func sync(_ registration: RelayRegistration, credentials: RelayCredentials?) async throws -> RelayCredentials {
        if let credentials {
            do {
                return try await update(registration, credentials: credentials)
            } catch RelayError.badDeviceSecret {
                return try await create(registration)
            } catch RelayError.status(404) {
                return try await create(registration)
            }
        }
        return try await create(registration)
    }

    /// A new subscription. The device secret comes back only now.
    public func create(_ registration: RelayRegistration) async throws -> RelayCredentials {
        let request = registerRequest(registration, credentials: nil)
        let body = try await send(request)
        guard let answer = try? JSONDecoder().decode(RegisterAnswer.self, from: body),
              !answer.subscriptionId.isEmpty, let secret = answer.deviceSecret, !secret.isEmpty
        else { throw RelayError.badResponse }
        return RelayCredentials(subscriptionId: answer.subscriptionId, deviceSecret: secret)
    }

    /// Updates the subscription. The token is left out: the relay keeps the one it stored.
    public func update(_ registration: RelayRegistration, credentials: RelayCredentials) async throws -> RelayCredentials {
        let request = registerRequest(registration, credentials: credentials)
        let body = try await send(request)
        guard let answer = try? JSONDecoder().decode(RegisterAnswer.self, from: body), !answer.subscriptionId.isEmpty
        else { throw RelayError.badResponse }
        return RelayCredentials(subscriptionId: answer.subscriptionId, deviceSecret: credentials.deviceSecret)
    }

    /// "Remove this phone": deletes the subscription and the relay's copy of the token. A
    /// subscription that is already gone counts as removed.
    public func delete(_ credentials: RelayCredentials) async throws {
        do {
            _ = try await send(deleteRequest(credentials))
        } catch RelayError.status(404) {
            return
        }
    }

    // MARK: - Requests (internal so tests can check exactly what is sent)

    func registerRequest(_ registration: RelayRegistration, credentials: RelayCredentials?) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("live/register"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credentials { request.setValue(credentials.deviceSecret, forHTTPHeaderField: "x-device-secret") }
        let body = RegisterBody(registration: registration, subscriptionId: credentials?.subscriptionId)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        request.httpBody = try? encoder.encode(body)
        return request
    }

    func deleteRequest(_ credentials: RelayCredentials) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("live/register").appendingPathComponent(credentials.subscriptionId))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 20
        request.setValue(credentials.deviceSecret, forHTTPHeaderField: "x-device-secret")
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let body: Data
        let status: Int
        do {
            (body, status) = try await transport.send(request)
        } catch {
            throw RelayError.unreachable
        }
        if (200..<300).contains(status) { return body }
        let code = (try? JSONDecoder().decode(ErrorAnswer.self, from: body))?.error
        switch (status, code) {
        case (400, "not-https"): throw RelayError.notHTTPS
        case (400, _): throw RelayError.validation
        case (401, _): throw RelayError.badDeviceSecret
        case (422, "nightscout-refused"): throw RelayError.nightscoutRefused
        case (422, _): throw RelayError.nightscoutUnreachable
        case (429, _): throw RelayError.rateLimited
        default: throw RelayError.status(status)
        }
    }

    private struct RegisterAnswer: Decodable {
        var subscriptionId: String
        var deviceSecret: String?
    }

    private struct ErrorAnswer: Decodable {
        var error: String
    }

    /// Spells out every key the contract lists: absent `subscriptionId` on create and absent
    /// `nightscoutToken` on update; the tokens and `activityStartedAt` as `null` when there are none.
    private struct RegisterBody: Encodable {
        let registration: RelayRegistration
        let subscriptionId: String?

        enum CodingKeys: String, CodingKey {
            case subscriptionId, nightscoutUrl, nightscoutToken, pushToStartToken, activityPushToken,
                 activityStartedAt, deviceToken, apnsEnvironment, unit, thresholds, alertsOn, language
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            let r = registration
            if let subscriptionId {
                try c.encode(subscriptionId, forKey: .subscriptionId)
            } else if let token = r.nightscoutToken {
                // The token goes only on create; an update keeps the stored one.
                try c.encode(token, forKey: .nightscoutToken)
            }
            try c.encode(r.nightscoutUrl, forKey: .nightscoutUrl)
            try c.encode(r.pushToStartToken, forKey: .pushToStartToken)
            try c.encode(r.activityPushToken, forKey: .activityPushToken)
            try c.encode(r.activityStartedAt.map(RelayClient.iso8601), forKey: .activityStartedAt)
            try c.encode(r.deviceToken, forKey: .deviceToken)
            try c.encode(r.apnsEnvironment, forKey: .apnsEnvironment)
            try c.encode(r.unit, forKey: .unit)
            try c.encode(r.thresholds, forKey: .thresholds)
            try c.encode(r.alertsOn, forKey: .alertsOn)
            try c.encode(r.language.rawValue, forKey: .language)
        }
    }

    static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
