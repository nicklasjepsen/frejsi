import FollowCore
import SwiftUI
import UIKit

/// Settings (plan §3): unit, colour thresholds, Live Activity, reminders, about, the disclaimer,
/// and "Remove this phone".
struct SettingsView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel
    @EnvironmentObject private var live: LiveActivityController
    @EnvironmentObject private var relay: RelaySync
    @EnvironmentObject private var notifications: NotificationController
    @Environment(\.dismiss) private var dismiss

    @AppStorage(LiveActivityLayout.arrowKey, store: LiveActivityLayout.defaults) private var showArrow = true
    @AppStorage(LiveActivityLayout.changeKey, store: LiveActivityLayout.defaults) private var showChange = true
    @AppStorage(LiveActivityLayout.unitKey, store: LiveActivityLayout.defaults) private var showUnit = true
    @AppStorage(LiveActivityLayout.ageStyleKey, store: LiveActivityLayout.defaults) private var ageStyle = LiveActivityLayout.AgeStyle.words.rawValue

    @State private var confirmRemove = false
    @State private var removeFailed = false
    @State private var removing = false

    var body: some View {
        NavigationStack {
            Form {
                Section(L("settings.following")) {
                    if let host = follow.source?.displayHost {
                        Text(host)
                        if case .nightscout(let site, _) = follow.source {
                            NavigationLink {
                                InviteView(site: site)
                            } label: {
                                Label(L("invite.title"), systemImage: "person.badge.plus")
                            }
                        }
                    } else {
                        Text(L("settings.following.demo"))
                    }
                }

                Section(L("settings.unit")) {
                    Picker(L("settings.unit"), selection: Binding(get: { follow.settings.unit }, set: { app.setUnit($0) })) {
                        ForEach(GlucoseUnit.allCases, id: \.self) { unit in
                            Text(unit.label).tag(unit)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    thresholdSteppers
                } header: {
                    Text(L("settings.colours"))
                } footer: {
                    Text(L("settings.colours.footer"))
                }

                Section {
                    Toggle(L("settings.live"), isOn: Binding(get: { follow.settings.liveActivityOn }, set: { app.setLiveActivity($0) }))
                } footer: {
                    Text(L("settings.live.footer"))
                }

                Section {
                    Toggle(L("settings.layout.arrow"), isOn: $showArrow)
                    Toggle(L("settings.layout.change"), isOn: $showChange)
                    Toggle(L("settings.layout.unit"), isOn: $showUnit)
                    Picker(L("settings.layout.age"), selection: $ageStyle) {
                        Text(L("settings.layout.age.words")).tag(LiveActivityLayout.AgeStyle.words.rawValue)
                        Text(L("settings.layout.age.timer")).tag(LiveActivityLayout.AgeStyle.timer.rawValue)
                    }
                } header: {
                    Text(L("settings.layout"))
                } footer: {
                    Text(L("settings.layout.footer"))
                }
                .disabled(!follow.settings.liveActivityOn)
                .onChange(of: [showArrow, showChange, showUnit]) { live.redraw() }
                .onChange(of: ageStyle) { live.redraw() }

                Section {
                    Toggle(L("settings.alerts"), isOn: Binding(get: { follow.settings.alertsOn }, set: { app.setAlerts($0) }))
                    if notifications.denied {
                        Button(L("settings.alerts.denied")) {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .font(.footnote)
                    }
                } footer: {
                    Text(L("settings.alerts.footer"))
                }

                if let error = relay.error {
                    Section {
                        Label(Self.describe(error), systemImage: "icloud.slash")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }

                Section(L("settings.about")) {
                    Link(L("settings.privacy"), destination: URL(string: "https://naensom.jepsen.ninja/privacy")!)
                    Link(L("settings.support"), destination: URL(string: "https://naensom.jepsen.ninja/support")!)
                    LabeledContent(L("settings.version"), value: Self.version)
                }

                Section {
                    Text(L("disclaimer"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                #if DEBUG
                Section(L("settings.debug.tokens")) {
                    TokenRow(title: L("settings.debug.activity"), token: live.activityToken)
                    TokenRow(title: L("settings.debug.pushToStart"), token: live.pushToStartToken)
                    TokenRow(title: L("settings.debug.device"), token: notifications.deviceToken)
                }
                #endif

                Section {
                    Button(role: .destructive) {
                        confirmRemove = true
                    } label: {
                        HStack {
                            Text(L("settings.remove"))
                            if removing {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(removing)
                } footer: {
                    Text(L("settings.remove.footer"))
                }
            }
            .navigationTitle(L("settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("common.done")) { dismiss() }
                }
            }
            .confirmationDialog(L("settings.remove.confirm.title"), isPresented: $confirmRemove, titleVisibility: .visible) {
                Button(L("settings.remove"), role: .destructive) { remove(localOnly: false) }
                Button(L("common.cancel"), role: .cancel) {}
            } message: {
                Text(L("settings.remove.confirm.message"))
            }
            .alert(L("settings.remove.failed.title"), isPresented: $removeFailed) {
                Button(L("settings.remove.localOnly"), role: .destructive) { remove(localOnly: true) }
                Button(L("common.cancel"), role: .cancel) {}
            } message: {
                Text(L("settings.remove.failed.message"))
            }
        }
    }

    @ViewBuilder private var thresholdSteppers: some View {
        let unit = follow.settings.unit
        ForEach(GlucoseThresholds.Kind.allCases, id: \.self) { kind in
            Stepper {
                HStack {
                    Text(Self.label(kind))
                    Spacer()
                    Text("\(follow.thresholds.formatted(kind, unit: unit, locale: AppLanguage.locale)) \(unit.label)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            } onIncrement: {
                app.step(kind, by: 1)
            } onDecrement: {
                app.step(kind, by: -1)
            }
        }
        if follow.source?.isDemo == false {
            Button(L("settings.colours.reset")) { app.resetThresholds() }
        } else {
            Button(L("settings.colours.resetDefaults")) { app.resetThresholds() }
        }
    }

    private func remove(localOnly: Bool) {
        removing = true
        Task {
            let removed = await app.remove(localOnly: localOnly)
            removing = false
            if removed {
                dismiss()
            } else {
                removeFailed = true
            }
        }
    }

    private static func label(_ kind: GlucoseThresholds.Kind) -> String {
        switch kind {
        case .urgentLow: return L("threshold.urgentLow")
        case .low: return L("threshold.low")
        case .high: return L("threshold.high")
        case .urgentHigh: return L("threshold.urgentHigh")
        }
    }

    static func describe(_ error: RelayError) -> String {
        switch error {
        case .unreachable, .status, .badResponse: return L("relay.error.unreachable")
        case .rateLimited: return L("relay.error.rateLimited")
        case .nightscoutRefused: return L("relay.error.nightscoutRefused")
        case .nightscoutUnreachable: return L("relay.error.nightscoutUnreachable")
        case .validation, .notHTTPS, .badDeviceSecret: return L("relay.error.refused")
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}

#if DEBUG
/// A push token for the push test (ios/README.md), shortened, with Copy.
private struct TokenRow: View {
    let title: String
    let token: String?

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(title)
                Text(token.map { "\($0.prefix(8))…\($0.suffix(6))" } ?? "–")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let token {
                Button(L("common.copy")) { UIPasteboard.general.string = token }
            }
        }
    }
}
#endif
