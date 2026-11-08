import Combine
import Foundation
import os
import UIKit
import UserNotifications

/// The low/high reminders (plan §1): the relay sends them as ordinary alert pushes to the app's
/// APNs device token. They follow silent mode and Focus like any notification and do not replace
/// the CGM app's alarms.
@MainActor
final class NotificationController: ObservableObject {
    static let shared = NotificationController()

    @Published private(set) var deviceToken: String?
    /// The user said no to notifications; the switch explains where to allow them.
    @Published private(set) var denied = false

    /// Called when the device token arrives or changes.
    var onDeviceToken: (() -> Void)?

    private let logger = Logger(subsystem: "ninja.jepsen.naensom", category: "notifications")

    /// Asks for permission and, when given, registers for remote notifications. Answers whether
    /// notifications are allowed.
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        denied = !granted
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        return granted
    }

    /// At launch, when reminders are on: registers again (the token can change) without asking.
    func registerIfAllowed() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            denied = false
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            denied = true
        default:
            break
        }
    }

    func received(_ token: String) {
        logger.notice("device token received")
        guard token != deviceToken else { return }
        deviceToken = token
        onDeviceToken?()
    }

    func reset() {
        UIApplication.shared.unregisterForRemoteNotifications()
        deviceToken = nil
        denied = false
    }
}

/// Receives the APNs device token, and shows a reminder that arrives while the app is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.hexString
        Task { @MainActor in NotificationController.shared.received(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Logger(subsystem: "ninja.jepsen.naensom", category: "notifications").error("remote notification registration failed")
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
