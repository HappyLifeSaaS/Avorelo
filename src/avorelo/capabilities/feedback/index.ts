// Avorelo feedback capability. Opt-in customer dogfooding and support bundles.
// Default: off. All data stays local. No automatic upload. No secrets collected.

export { getFeedbackConfig, optIn, optOut, type FeedbackConfig } from "./config.ts";
export {
  prepareFeedbackBundle, prepareSupportBundle, renderSupportMarkdown,
  validateSupportBundle, SUPPORT_BUNDLE_ALLOWLIST,
  SUPPORT_ISSUES_URL, SUPPORT_SECURITY_URL, SUPPORT_EMAIL, type FeedbackBundle,
} from "./bundle.ts";
