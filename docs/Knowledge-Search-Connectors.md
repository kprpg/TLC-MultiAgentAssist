# Knowledge search: Seismic Graph first, direct MCP later

## Scope and status

TLC has a reusable, read-only `searchKnowledge` operation. This is infrastructure
for a future content/PPT search experience, **not a new search pane or an agent
prompt-routing change**. No content is downloaded, shared, uploaded, or modified.

| Source | Current implementation |
| --- | --- |
| `seismic-m365` | Microsoft Graph Search over an existing Seismic Content connector's external items. Requires a configured connection ID, delegated Graph consent, and the user's indexed-content access. |
| `seismic-mcp` | Explicit unavailable placeholder. No OAuth, MCP connection, or tool calls are attempted. Replace its provider after approval. |
| `mcem` | Reserved registration point. Existing MCEM guidance and its local snapshot behavior remain unchanged; this change does not implement a portal search provider. |

Do not choose one Seismic integration permanently. Graph retrieves the M365-indexed
Seismic corpus; a future direct MCP adapter can expose approved native retrieval
capabilities behind the same evidence contract. Neither silently falls back to
the other, changes identity, or returns sample content in live mode.

## Layers and interface

```text
Desktop IPC / Web HTTP / VS Code webview bridge
                    |
        ThinSliceOrchestrator.searchKnowledge
                    |
          KnowledgeSearchService
                    |
       KnowledgeSource.search(request)
          |                    |
  SeismicM365Provider    SeismicMCPProvider
  Graph externalItem    unavailable placeholder
```

The independently versioned strict v1.0 contract lives in
[`packages/common/contracts/knowledge.ts`](../packages/common/contracts/knowledge.ts).
The connector interface is in
[`packages/connectors/common/knowledge.ts`](../packages/connectors/common/knowledge.ts);
composition and dispatch are in
[`packages/orchestrator/knowledge-search.ts`](../packages/orchestrator/knowledge-search.ts).

Callers provide one request envelope (the transport representation of
`searchKnowledge(query, source, filters)`):

```ts
const response = await client.searchKnowledge({
  contractVersion: '1.0',
  source: 'seismic-m365',
  query: 'Azure AI',
  filters: { fileTypes: ['ppt', 'pptx'] },
  limit: 10
})
if (response.kind === 'results') {
  // Render titles/snippets as untrusted text; show each hit's evidenceId and URL.
  // Show sourceHealth, warnings, and a continuation control when hasMore is true.
} else {
  // Show response.code and response.message instead of "no documents found".
}
```

The shared operation catalog registers `searchKnowledge` as a read, not a source
mutation or agent run. The established transports expose:

| Surface | Entry point |
| --- | --- |
| Desktop | `window.tlc.searchKnowledge(request)` over `tlc:search-knowledge`, with trusted-sender enforcement |
| Web | `POST /api/knowledge/search`, with the existing authentication, same-origin, body-size, and no-store controls |
| VS Code | `searchKnowledge` on the typed webview bridge and `dataClient.searchKnowledge(request)` |
| Shared operation catalog | `operations.invoke('searchKnowledge', request)` |

Desktop/Web data clients and both VS Code sample providers are wired. The operation
does not depend on selected accounts, send a prompt to Foundry, or alter agent behavior.

## Phase 1: configure and verify the existing Seismic M365 connector

This code **consumes an existing connector**. It does not create an external
connection, crawl Seismic, or install an M365 connector.

1. Ask the Microsoft 365 Search/Copilot connector owner for the exact Seismic
   **external connection ID**. It is not the connector display name, Seismic
   tenant name, or an OAuth client ID.
2. Confirm the connection is populated and its content ACLs are configured.
   An existing Copilot/WorkIQ result does not prove that TLC's own Graph client
   has consent or access.
3. Grant the TLC host's approved Entra client delegated
   **`ExternalItem.Read.All`** for Microsoft Graph, with tenant consent where
   required. This feature does not request application-wide ingestion permissions.
4. Confirm the connector's retrievable properties for title, original content
   URL, and (for PPT filtering) file extension or MIME type.
5. Set host environment variables before launching TLC:

   ```powershell
   $env:TLC_SEISMIC_GRAPH_CONNECTION_ID = 'YourConnectionId'
   $env:TLC_SEISMIC_GRAPH_TITLE_PROPERTY = 'title'
   $env:TLC_SEISMIC_GRAPH_URL_PROPERTY = 'url'
   # Optional: use the actual retrievable property names from the connector schema.
   $env:TLC_SEISMIC_GRAPH_FILE_TYPE_PROPERTY = 'fileType'
   $env:TLC_SEISMIC_GRAPH_MODIFIED_PROPERTY = 'lastModifiedDateTime'
   ```

   Only the connection ID is mandatory. Title and URL property names default to
   `title` and `url`; those defaults are not a claim about the Microsoft tenant's
   schema. File type and modification date are requested only when mapped.
   Configuration is validated on a search, so an unavailable optional knowledge
   source does not prevent ordinary TLC startup.

6. Make one authorized search for a known Seismic document; compare its title,
   original URL and file type with Seismic. Then verify a PPT-only search, a
   no-match query, and permission-denied behavior. Do not treat a unit-test
   fixture as a live tenant verification.

### Authentication by host

- **Desktop:** interactive sign-in requests the separate
  `https://graph.microsoft.com/ExternalItem.Read.All` grant on first search.
  Azure CLI credentials request Graph's `.default` scope instead; the CLI client
  must already have the external-item permission consented.
- **VS Code:** requests that Graph grant through VS Code's Microsoft account
  provider and checks that the account matches the current TLC account. Tokens
  remain in the extension host.
- **Local Web (`TLC_WEB_MODE=azure-cli`):** acquires a separate delegated Graph
  `.default` token and checks its account against the authenticated local web
  user. The CLI client must already have the external-item permission consented;
  it cannot acquire new consent by requesting an individual permission as a
  resource. This mode retains its loopback-only binding.
- **Hosted Web / Easy Auth:** does not forward its MSX-audience access token to
  Graph and never falls back to a developer's Azure CLI account. Without a
  dedicated Graph token provider it returns `graph-auth-not-configured`.
  An approved per-user Graph/OBO integration can be injected through
  `HostedRuntimeOptions.getGraphKnowledgeToken(authentication)` later; it is
  **not implemented by this change**.
- **Shared application runtime:** uses its existing explicit `getToken('graph')`
  callback. That host is responsible for supplying the current user's delegated
  Graph grant.

GitHub Copilot/WorkIQ configuration in a user's MCP settings does not automatically
give the TLC extension, desktop process, or web server access. No personal MCP
configuration, client secret, token, or tenant document is checked into this feature.

### Query, filters, and paging

The only network request is a bounded, timed
`POST https://graph.microsoft.com/v1.0/search/query`, with:

- `entityTypes: ['externalItem']`;
- a fixed `contentSources: ['/external/connections/<configured-id>']`;
- the supplied query string, a bounded `from`/`size`, and explicitly mapped fields.

The query follows Microsoft Graph Search query semantics; it is not an LLM
instruction. Callers cannot supply arbitrary endpoints, connection IDs or tokens.

File-type filtering is **local to each retrieved Graph page**, not a claim that
every connector has a queryable `fileType` property. The provider uses mapped
extension/MIME metadata, otherwise a recognizable URL-path extension. It does not
guess a file type from a title or from a native Seismic link with no extension.
With filters, a page may therefore contain fewer than `limit` hits, including zero.
Continue with `nextOffset` while `hasMore` is true; it advances by **raw Graph
hits**, including filtered or invalid items. No filtered-total count is invented.
Search offsets are limited to 10,000; narrow broader queries.

Every result has an actual index ID, stable evidence ID, original HTTPS URL,
source, and `untrusted: true`. Snippets are bounded text with markup removed.
Invalid titles/links, cross-connection results and malformed items are omitted
with a partial-source warning. Unknown file types under a file filter also produce
a warning. Source/index freshness is limited by the M365 connector's crawl schedule;
the source health check time is not a document modification date.

HTTP denials, throttling, transport errors, malformed responses and missing setup
are explicit unavailable responses. There is no retry to a different identity,
unscoped search, sample fallback, raw-error disclosure, or server-side fetch of
returned content links.

## Sample mode

The canonical synthetic knowledge fixtures live in
[`packages/common/fixtures/knowledge.ts`](../packages/common/fixtures/knowledge.ts).
They support text matching, file-type filters, and paging without sign-in or
network access. Search `Azure AI` for a sample presentation and PDF, or `Fabric`
for a sample presentation. URLs use the reserved `.test` domain and are not real
Seismic documents. Direct MCP remains explicitly unavailable even in sample mode.

## Phase 2: replace the direct MCP placeholder

The official tenant endpoint pattern is:

```text
https://mcp.seismic.com/v1/tenants/{tenantname}
```

Do not enable this provider just because that endpoint publishes metadata.
First obtain Seismic tenant MCP enablement, the required Aura entitlement, an
approved MCP app, Seismic authorization-code OAuth credentials/callbacks, and
administrator-approved **read-only tools**. `seismic.mcp` is not itself a
read-only scope. M365/Graph tokens are not Seismic access tokens.

Then implement `KnowledgeSource` with `id: 'seismic-mcp'`, map validated native
search results to `KnowledgeSearchPage`/`KnowledgeHit`, and replace the placeholder
in shared composition. Keep per-user authorization, explicit tool allowlisting,
HTTPS evidence, bounded responses and honest failure states. Do not generate
LiveSend links or invoke writes as a substitute for retrieval. The public request,
orchestrator operation and UI transport contracts need not change.

## Documentation

- [Microsoft Graph Search query API](https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0)
- [Graph connector search schema](https://learn.microsoft.com/en-us/graph/connecting-external-content-manage-schema)
- [Seismic MCP overview](https://developer.seismic.com/seismicsoftware/docs/seismic-mcp-server)
- [Seismic MCP app creation and installation](https://developer.seismic.com/seismicsoftware/docs/creating-and-installing-an-mcp-app-in-seismic)
- [Seismic MCP client connection guide](https://developer.seismic.com/seismicsoftware/docs/how-to-connect-to-seismics-remote-mcp-server-general-case)

Live Seismic/Graph access and tenant-specific property mappings are not verified
by the offline tests. They remain deployment prerequisites, not completed work.
