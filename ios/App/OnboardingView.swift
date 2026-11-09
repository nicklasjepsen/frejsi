import FollowCore
import SwiftUI

/// One screen (plan §3): tap the link you were sent; or scan its QR code, or type the address and a
/// read-only token. "Test connection" reads one entry before anything is saved. "Try the demo"
/// follows made-up data.
struct OnboardingView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var follow: FollowModel

    @State private var siteField = ""
    @State private var tokenField = ""
    @State private var showManual = false
    @State private var showScanner = false
    @State private var testing = false
    @State private var tested: Tested?
    @State private var problem: String?

    /// A connection test that passed, for exactly these details.
    private struct Tested {
        var source: FollowSource
        var newest: Reading?
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "link")
                            .font(.largeTitle)
                            .foregroundStyle(.tint)
                        Text(L("onboarding.title"))
                            .font(.title2.bold())
                        Text(L("onboarding.body"))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }

                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label(L("onboarding.scan"), systemImage: "qrcode.viewfinder")
                    }
                    Button {
                        withAnimation { showManual.toggle() }
                    } label: {
                        Label(L("onboarding.manual"), systemImage: "keyboard")
                    }
                }

                if showManual {
                    Section {
                        TextField(L("onboarding.site"), text: $siteField, prompt: Text("https://…"))
                            .textContentType(.URL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField(L("onboarding.token"), text: $tokenField)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button {
                            Task { await testConnection() }
                        } label: {
                            HStack {
                                Text(L("onboarding.test"))
                                if testing {
                                    Spacer()
                                    ProgressView()
                                }
                            }
                        }
                        .disabled(testing || siteField.isEmpty || tokenField.isEmpty)
                    } footer: {
                        Text(L("onboarding.manual.footer"))
                    }
                }

                if let problem {
                    Section {
                        Label(problem, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                if let tested {
                    Section {
                        // Re-rendered so the reading's age stays true while the result is open.
                        TimelineView(.periodic(from: .now, by: 15)) { context in
                            Label(testedText(tested, now: context.date), systemImage: "checkmark.circle")
                                .foregroundStyle(.green)
                        }
                        Button(L("onboarding.start")) {
                            app.finishOnboarding(tested.source)
                        }
                        .font(.headline)
                    }
                }

                Section {
                    Button {
                        app.finishOnboarding(.demo)
                    } label: {
                        Label(L("onboarding.demo"), systemImage: "play.circle")
                    }
                } footer: {
                    Text(L("onboarding.demo.footer"))
                }

                Section {
                    Text(L("disclaimer"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(Text(verbatim: "nænsom"))
            .sheet(isPresented: $showScanner) {
                ScannerSheet { text in
                    showScanner = false
                    switch Setup.parseScanned(text) {
                    case .success(let link): use(link)
                    case .failure: problem = L("onboarding.problem.notALink")
                    }
                }
            }
            .onChange(of: siteField) { forgetTestIfChanged() }
            .onChange(of: tokenField) { forgetTestIfChanged() }
            .task(id: app.pendingLink?.url()) {
                if let link = app.pendingLink {
                    app.pendingLink = nil
                    use(link)
                }
            }
        }
    }

    /// A link from a tap or a QR code: fill in the details and test them at once.
    private func use(_ link: FollowLink) {
        siteField = link.site.absoluteString
        tokenField = link.token
        showManual = true
        Task { await testConnection() }
    }

    private func testConnection() async {
        problem = nil
        tested = nil
        let source: FollowSource
        switch Setup.validate(site: siteField, token: tokenField) {
        case .success(let valid): source = valid
        case .failure(let failure):
            problem = Self.describe(failure)
            return
        }
        testing = true
        let result = await follow.feed.test(source)
        testing = false
        // The details may have changed while the test ran.
        guard case .success(source) = Setup.validate(site: siteField, token: tokenField) else { return }
        switch result {
        case .success(let newest): tested = Tested(source: source, newest: newest)
        case .failure(let failure): problem = failure.message(in: AppLanguage.current)
        }
    }

    /// A passed test counts only for the details it tested.
    private func forgetTestIfChanged() {
        guard let tested else { return }
        if case .success(tested.source) = Setup.validate(site: siteField, token: tokenField) { return }
        self.tested = nil
    }

    private func testedText(_ tested: Tested, now: Date) -> String {
        guard let newest = tested.newest else { return L("onboarding.connected.empty") }
        let unit = follow.settings.unit
        let value = "\(Glucose.format(newest.mgdl, unit: unit, locale: AppLanguage.locale)) \(unit.label)"
        let age = Glucose.ageText(newest, now: now, language: AppLanguage.current)
        return L("onboarding.connected", value, age)
    }

    static func describe(_ problem: SetupProblem) -> String {
        switch problem {
        case .missingAddress: return L("onboarding.problem.missingAddress")
        case .invalidAddress: return L("onboarding.problem.invalidAddress")
        case .notHTTPS: return L("onboarding.problem.notHTTPS")
        case .missingToken: return L("onboarding.problem.missingToken")
        case .notAFollowLink: return L("onboarding.problem.notALink")
        }
    }
}
