import Foundation
import Observation
import Security

/// Persists a server URL + Bearer token pair in the Keychain and hands out
/// a configured `Client` for it. There's no in-app sign-in flow on the
/// server side yet (see ApiToken's schema.prisma comment and
/// scripts/apiToken.ts) — a token still has to be minted out-of-band via
/// `npm run api-token create <email>` and pasted in. This is the
/// persistence + client-construction layer that a real sign-in flow would
/// sit on top of later; SignInView (ReadingRigUI) is the paste-it-in UI for
/// today.
@MainActor
@Observable
public final class AuthSession {
    public private(set) var baseURL: URL?
    private var token: String?

    public var isSignedIn: Bool { token != nil && baseURL != nil }

    public init() {
        if let stored = KeychainTokenStore.load() {
            baseURL = stored.baseURL
            token = stored.token
        }
    }

    public func signIn(baseURL: URL, token: String) {
        KeychainTokenStore.save(baseURL: baseURL, token: token)
        self.baseURL = baseURL
        self.token = token
    }

    public func signOut() {
        KeychainTokenStore.clear()
        baseURL = nil
        token = nil
    }

    public func makeClient() -> Client? {
        guard let baseURL, let token else { return nil }
        return ReadingRigClient.make(serverURL: baseURL, token: { [token] in token })
    }
}

/// A generic-password Keychain item under one fixed account name — there's
/// only ever one signed-in session per device, so no per-user lookup key is
/// needed. The base URL is stored alongside the token (not hardcoded)
/// because dev/staging-qa/production all have different hosts (see
/// railway.toml) and the signed-in server has to travel with the token.
private enum KeychainTokenStore {
    private static let service = "com.readingrig.ios.apiSession"
    private static let account = "default"

    struct Stored: Codable {
        let baseURL: URL
        let token: String
    }

    static func save(baseURL: URL, token: String) {
        guard let data = try? JSONEncoder().encode(Stored(baseURL: baseURL, token: token)) else { return }
        clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load() -> Stored? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return try? JSONDecoder().decode(Stored.self, from: data)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
