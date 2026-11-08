import FollowCore
import SwiftUI
import UIKit

/// The bare stage-2 screen: the value with its age, a button that starts the Live Activity, and the
/// two push tokens for the push test. Stage 3 replaces it with the real app (onboarding, curve,
/// settings, da/en).
struct ContentView: View {
    @EnvironmentObject private var model: FollowModel
    @EnvironmentObject private var activities: LiveActivityController
    @State private var siteField = ""
    @State private var tokenField = ""

    var body: some View {
        NavigationStack {
            Form {
                if model.isConfigured {
                    Section { reading }
                    Section("Live Activity") { liveActivity }
                    Section("Push tokens (for the push test)") { tokens }
                }
                Section("Nightscout") { connection }
                Section {
                    Text("Keep the CGM app and its alarms. This shows the glucose; it does not monitor it.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Nænsom")
            .refreshable { await model.refresh() }
        }
        .task(id: model.site + model.token) { await model.refreshWhileVisible() }
    }

    @ViewBuilder private var reading: some View {
        if let latest = model.latest {
            // TimelineView re-renders the age every 30 s; the value never appears without it.
            TimelineView(.periodic(from: .now, by: 30)) { context in
                let stale = Glucose.isStale(latest, now: context.date)
                let language = Language(localeIdentifier: Locale.current.identifier)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(Glucose.format(latest.mgdl, unit: .mmolL)) \(Glucose.arrow(latest.direction))")
                            .font(.system(size: 56, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(stale ? .gray : .primary)
                        Text(GlucoseUnit.mmolL.label).foregroundStyle(.secondary)
                    }
                    HStack {
                        Text(Glucose.ageText(latest, now: context.date, language: language))
                        if let delta = Glucose.formatDelta(latest, previous: model.previous, unit: .mmolL) {
                            Text("· \(delta)")
                        }
                        if stale { Text("· no new readings").foregroundStyle(.orange) }
                    }
                    .foregroundStyle(.secondary)
                }
            }
        } else if let error = model.error {
            Text(error).foregroundStyle(.orange)
        } else {
            ProgressView()
        }
    }

    @ViewBuilder private var liveActivity: some View {
        if activities.isRunning {
            Label("Running", systemImage: "checkmark.circle")
            Button("End Live Activity", role: .destructive) { activities.endAll() }
        } else if let latest = model.latest {
            Button("Start Live Activity") { activities.start(current: latest, previous: model.previous) }
        } else {
            Text("Waiting for a reading").foregroundStyle(.secondary)
        }
        if let error = activities.error {
            Text(error).foregroundStyle(.orange)
        }
    }

    @ViewBuilder private var tokens: some View {
        TokenRow(title: "Activity", token: activities.activityToken)
        TokenRow(title: "Push-to-start", token: activities.pushToStartToken)
    }

    @ViewBuilder private var connection: some View {
        TextField("Site address", text: $siteField, prompt: Text("https://…"))
            .textContentType(.URL)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        SecureField("Read-only token", text: $tokenField)
        Button("Save") { model.save(site: siteField, token: tokenField) }
            .disabled(siteField.isEmpty || tokenField.isEmpty)
            .onAppear {
                if siteField.isEmpty { siteField = model.site }
            }
    }
}

private struct TokenRow: View {
    let title: String
    let token: String?

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(title)
                Text(token.map { "\($0.prefix(8))…\($0.suffix(6))" } ?? "not yet")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let token {
                Button("Copy") { UIPasteboard.general.string = token }
            }
        }
    }
}
