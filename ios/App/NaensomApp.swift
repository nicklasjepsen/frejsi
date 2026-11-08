import FollowCore
import SwiftUI

@main
struct NaensomApp: App {
    @StateObject private var model = FollowModel()
    @StateObject private var activities = LiveActivityController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .environmentObject(activities)
                // The follow link (plan §3). Universal links come in stage 3 with the associated
                // domain; until then the link can be opened from Notes or Safari once that exists.
                .onOpenURL { url in
                    if let link = FollowLink.parse(url) { model.save(site: link.site.absoluteString, token: link.token) }
                }
                .task { activities.observe() }
        }
    }
}
