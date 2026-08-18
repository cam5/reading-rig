import XCTest
import HTTPTypes
import OpenAPIRuntime

@testable import ReadingRigKit

final class BearerAuthMiddlewareTests: XCTestCase {
    func testAttachesBearerHeaderWhenATokenIsAvailable() async throws {
        let middleware = BearerAuthMiddleware { "test-token" }
        let request = HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/api/v1/home")

        var capturedRequest: HTTPRequest?
        _ = try await middleware.intercept(
            request,
            body: nil,
            baseURL: URL(string: "https://example.com")!,
            operationID: "getHome"
        ) { req, _, _ in
            capturedRequest = req
            return (HTTPResponse(status: .ok), nil)
        }

        XCTAssertEqual(capturedRequest?.headerFields[.authorization], "Bearer test-token")
    }

    func testLeavesRequestUnmodifiedWhenNoTokenIsAvailable() async throws {
        let middleware = BearerAuthMiddleware { nil }
        let request = HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/api/v1/home")

        var capturedRequest: HTTPRequest?
        _ = try await middleware.intercept(
            request,
            body: nil,
            baseURL: URL(string: "https://example.com")!,
            operationID: "getHome"
        ) { req, _, _ in
            capturedRequest = req
            return (HTTPResponse(status: .ok), nil)
        }

        XCTAssertNil(capturedRequest?.headerFields[.authorization])
    }
}
