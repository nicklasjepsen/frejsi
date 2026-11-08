import FollowCore
import SwiftUI

@main
struct NaensomApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(app.follow)
                .environmentObject(app.live)
                .environmentObject(app.relay)
                .environmentObject(app.notifications)
                .environment(\.locale, AppLanguage.locale)
                // The follow link (plan §3), as a universal link (applinks:naensom.jepsen.ninja).
                .onOpenURL { url in app.open(url) }
                .task { app.launch() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { app.becameActive() }
        }
    }
}

/// Onboarding until the phone follows something, then the main screen.
struct RootView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel

    var body: some View {
        Group {
            if follow.source == nil {
                OnboardingView()
            } else {
                MainView()
            }
        }
        .alert(
            L("link.replace.title"),
            isPresented: Binding(get: { app.replacementLink != nil }, set: { if !$0 { app.replacementLink = nil } }),
            presenting: app.replacementLink
        ) { link in
            Button(L("link.replace.confirm"), role: .destructive) {
                Task { await app.replace(with: link) }
            }
            Button(L("common.cancel"), role: .cancel) { app.replacementLink = nil }
        } message: { link in
            Text(L("link.replace.message", link.site.host ?? ""))
        }
    }
}
