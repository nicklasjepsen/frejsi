import SwiftUI
import WidgetKit

/// The widget extension's one entry point: the Live Activity and the widgets live in the same
/// extension (`NaensomLiveActivity`, `ninja.jepsen.naensom.liveactivity`), which is valid and saves
/// a second app ID, signing profile and upload step. WidgetBundleBuilder allows no `if #available`;
/// the iOS 18 check is inside `GlucoseLiveActivity`.
@main
struct NaensomWidgetBundle: WidgetBundle {
    var body: some Widget {
        GlucoseLiveActivity()
        GlucoseWidget()
    }
}
