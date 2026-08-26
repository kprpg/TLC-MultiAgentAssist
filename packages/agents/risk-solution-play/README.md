# Risk and Solution Play Agent

Produces supported execution-risk reviews and approved solution engagement packages.

## Inputs

Versioned orchestrator context containing intent, role, account and opportunity signals, source health, and approved SharePoint or Seismic asset evidence.

## Outputs

Risk severity, signals, impact, mitigation, owners, and optional solution package with narrative, assets, demo path, objections, proof points, and reviewed follow-up.

## Dependencies

Common contracts and orchestrator-supplied evidence. Connector access and cross-agent routing remain outside this package.

## Failure Behavior

Omits unsupported risks and assets. A noncritical content-source failure yields explicit partial results; missing critical opportunity context stops unsupported analysis.

## Owner

Risk and Solution Play capability owner.