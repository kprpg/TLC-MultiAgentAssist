// Static-preview isolation zone: the standalone preview has no host, so it reuses the orchestrator's
// deterministic sample reporting host. Live Desktop/Web renderers must not import this.
export { createSampleSeReportingHost as createPreviewSeReportingHost } from '../../../../../packages/orchestrator/se-reporting/sample.js'
