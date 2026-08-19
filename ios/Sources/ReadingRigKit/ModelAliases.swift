// Short names for the deeply-nested types swift-openapi-generator produces
// for inline (non-$ref'd) response schemas — e.g. a shelf entry's real type
// is `Operations.getHome.Output.Ok.Body.jsonPayload.worksPayloadPayload`.
// Only the shapes ReadingRigUI's current screens actually render get an
// alias; add more here as more of the response gets used.

public typealias ShelfWork = Operations.getHome.Output.Ok.Body.jsonPayload.worksPayloadPayload

public typealias ReadableWork = Operations.getRead.Output.Ok.Body.jsonPayload.workPayload

public typealias ContentParagraph = Operations.getRead.Output.Ok.Body.jsonPayload.contentPayload
    .paragraphsPayloadPayload
