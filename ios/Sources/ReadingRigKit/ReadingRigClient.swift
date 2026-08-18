import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// Injects `Authorization: Bearer <token>` on every outgoing request — the
/// client-side counterpart to `resolveBearerToken`
/// (app/auth/apiToken.server.ts). Token storage/rotation is the app's job;
/// this middleware only attaches whatever the closure hands it, and skips
/// the header entirely when there's nothing to attach.
public struct BearerAuthMiddleware: ClientMiddleware {
    private let token: @Sendable () async -> String?

    public init(token: @escaping @Sendable () async -> String?) {
        self.token = token
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token = await token() {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}

/// Thin factory over the plugin-generated `Client` — its own initializer
/// already takes a server URL, transport, and middleware list, so this
/// exists only to pin the one combination the app actually uses (URLSession
/// transport, Bearer auth) rather than repeating that wiring at every call
/// site that needs a client.
public enum ReadingRigClient {
    public static func make(
        serverURL: URL,
        token: @escaping @Sendable () async -> String?
    ) -> Client {
        Client(
            serverURL: serverURL,
            transport: URLSessionTransport(),
            middlewares: [BearerAuthMiddleware(token: token)]
        )
    }
}
