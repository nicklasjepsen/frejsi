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
                    Section {
                        thresholdSteppers
                    } header: {
                        Text("Colours")
                    } footer: {
                        Text("Green from low to high, yellow outside it, red at or beyond the urgent values, grey when the reading is more than 15 minutes old. Colours only: no alarms.")
                    }
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
                let colour = Glucose.color(latest, thresholds: model.thresholds, now: context.date).color
                let language = AppLanguage.current
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(Glucose.format(latest.mgdl, unit: .mmolL, locale: AppLanguage.locale)) \(Glucose.arrow(latest.direction))")
                            .font(.system(size: 56, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(colour)
                        Text(GlucoseUnit.mmolL.label).foregroundStyle(.secondary)
                    }
                    HStack {
                        Text(Glucose.ageText(latest, now: context.date, language: language))
                        if let delta = Glucose.formatDelta(latest, previous: model.previous, unit: .mmolL, locale: AppLanguage.locale) {
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

    @ViewBuilder private var thresholdSteppers: some View {
        ForEach(GlucoseThresholds.Kind.allCases, id: \.self) { kind in
            Stepper {
                HStack {
                    Text(Self.label(kind))
                    Spacer()
                    Text("\(model.thresholds.formatted(kind, unit: .mmolL, locale: AppLanguage.locale)) \(GlucoseUnit.mmolL.label)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            } onIncrement: {
                model.step(kind, by: 1, unit: .mmolL)
                activities.redraw()
            } onDecrement: {
                model.step(kind, by: -1, unit: .mmolL)
                activities.redraw()
            }
        }
        Button("Use the Nightscout site's values") {
            model.resetThresholds()
            activities.redraw()
        }
    }

    private static func label(_ kind: GlucoseThresholds.Kind) -> String {
        switch kind {
        case .urgentLow: return "Urgent low"
        case .low: return "Low"
        case .high: return "High"
        case .urgentHigh: return "Urgent high"
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
