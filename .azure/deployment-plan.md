# Web App Packaging and Deployment Plan

Status: Deployed and Healthy

## Goal

Package the existing web application and deploy it to the existing Linux Azure App Service `tlc` in resource group `myDemoRg`.

## Confirmed Target

- Subscription: `cbaf34df-7bb5-4fcf-bd7d-686a5f43ad31`
- Subscription tenant: `72f988bf-86f1-41af-91ab-2d7cd011db47`
- Resource group: `myDemoRg`
- Web app: `tlc`
- App Service plan: `ASP-myDemoRg-94e3`
- Production URL: `https://tlc-frfwf5g4g8edhcc0.westus3-01.azurewebsites.net`

The requested tenant `173eb3fc-9ba1-437f-99a1-89d5e53b91d1` does not own the subscription and cannot be used as the deployment tenant.

## Proposed Delivery

1. Add a PowerShell wrapper around the existing `npm run web:release` package builder.
2. Validate the ZIP central directory and required root files before upload.
3. Validate Azure CLI authentication, subscription tenant, resource group, app, plan, and hostname.
4. Deploy with `az webapp deploy --track-status false` in run-from-package mode and verify `/api/health` with bounded retries.
5. Validate and provision the non-secret Foundry environment metadata through the `TLC_FOUNDRY_ENV_BASE64` App Service setting.
6. Support package-only, skip-build, and optional deployment-slot operation.
7. Add automated tests and run focused packaging/script validation.

## Azure Developer CLI Assessment

The repository currently has no `azure.yaml`, infrastructure definitions, or azd environment. `azd up` combines provisioning and deployment, so it should not be made the default for an existing production resource. An azd path would require a separately approved infrastructure ownership design that imports or safely references the existing App Service without recreating or replacing it.

## Safety Boundaries

- Change only the `TLC_FOUNDRY_ENV_BASE64` and `WEBSITE_RUN_FROM_PACKAGE` App Service settings required by the hosted runtime and deployment path; do not change authentication, identities, networking, or plan configuration.
- Do not create, replace, or delete Azure resources.
- Do not swap deployment slots.
- Do not upload an archive that fails integrity checks.
- Require an explicit production confirmation before upload.

## Validation Proof

- The initial OneDeploy operation succeeded, but Azure CLI lost its TLS connection while tracking status and returned exit code 1.
- The deployed process then exited because the clean ZIP deployment correctly excluded the live Foundry environment file and no external hosted setting had been configured.
- Focused configuration and deployment-wrapper tests cover Base64-hosted configuration and disabled CLI status tracking.
- The full web build and packaged-server smoke test passed.
- The generated 145.37 MB ZIP passed independent central-directory and required-root-file validation.
- PowerShell `-WhatIf` verified the subscription, tenant, App Service plan, Linux web app, and hostname, then stopped before upload.
- An extraction-based recovery deployment was accepted as `faf8fa0f-0012-4f54-9824-cc06d990ab99` but stalled while Kudu zipped the 78,700-entry `node_modules` tree.
- Enabling `WEBSITE_RUN_FROM_PACKAGE=1` bypassed extraction and optimization. Deployment `a69052f6-545c-4179-b666-9b2b31ec6c48` completed with status `4` on 2026-09-10 UTC.
- The wrapper health gate and an independent request both confirmed HTTP 200 with `{ "status": "ready" }` from the production `/api/health` endpoint.

## Teams surface preparation (separate from the deployed Web application)

Status: Preparing locally; no deployment requested.

- Authorized branch: `feature/vscode-extension-Teams`, baseline `46990c0`.
- Implement the local Teams plan using test-first slices and cumulative validation.
- Preserve the deployed Web host and its Easy Auth boundary.
- Build a dedicated Teams runtime, importable manifest/icons ZIP, and F5 workflow.
- The Teams upload ZIP references a reachable HTTPS host; it cannot contain a
  running backend. Produce a separate host-runtime bundle and configuration checks.
- Corporate FTE entitlement, Entra A/B/C registrations/consent, actual MCP client
  allowlisting, Graph permissions/tenant policy and governed shared disclosure remain
  external release gates. Do not borrow operator/CLI source credentials or bypass
  these gates; local Foundry workload credentials are separate from source access.
- No existing Azure resource, tenant setting or production deployment is modified.
- The user operates the same Node/UI runtime locally on Windows for development/test
  now and can deploy it to Azure later. No preexisting vendor/operator is assumed.
  Local live state is encrypted SQLite and Foundry uses a tenant-pinned Azure CLI
  workload credential; no managed identity or Table service is required locally.
  The explicit Azure profile retains managed identity and configured Table Storage.
  Every FTE colleague retains their own signed-in delegated source permissions.
- HTTPS exposure is opt-in and unapproved here: no tunnel, networking changes,
  resource provisioning or deployment is performed. The installation ZIP neither
  starts the user's laptop server nor deploys Azure resources.
- Development/template packages are explicitly labeled and do not establish
  installed-host readiness. Public UI/API probes do not establish tenant consent,
  Teams sign-in, source permissions or full-suite production readiness.
- Baseline regression issue: duplicate `target` declaration in the existing
  orchestrator integration test; record separately from the Teams red/green tests.