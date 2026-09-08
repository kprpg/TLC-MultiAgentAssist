# Frequently Asked Questions

## Accounts and opportunities

### Why do I see these customer accounts and opportunities?

In live mode, TLC MultiAgent Assist builds your portfolio from your active MSX deal-team memberships. It does not retrieve every opportunity belonging to a customer account.

An opportunity appears when all of the following are true:

- Your signed-in MSX user has an active deal-team record linked to the opportunity.
- The opportunity is active.
- The opportunity has an active parent customer account that you can access.

The app identifies your MSX user from your authenticated session. It then finds the opportunities linked to your active deal-team records and groups those opportunities by their parent customer account. Selecting an account shows only the eligible opportunities associated with that account.

Opportunity ownership, account ownership, sales stage, close date, value, and milestone ownership do not determine whether an opportunity appears. Being an account-team member without an active opportunity deal-team record is also not sufficient under the current selection rules.

Accounts and opportunities are displayed alphabetically. The portfolio is cached during the session for performance and is reloaded when you refresh the account context.

### Why is an expected opportunity missing?

Confirm in MSX that:

1. You are listed on an active deal-team record for that specific opportunity.
2. The opportunity is active.
3. The opportunity has an active parent account.
4. Your signed-in identity has permission to read those records.

After correcting MSX data or access, refresh the account context in the app. If the opportunity remains missing, contact the application support team with the account and opportunity names. Do not include access tokens or other credentials.

### Why do I see an account but not all of its opportunities?

Accounts are derived from your eligible opportunities. The app does not use the selected account to retrieve every opportunity under that account. Each displayed opportunity must independently satisfy the active deal-team membership and active-record rules above.

## Data access

### Does the app grant me access to additional MSX records?

No. TLC MultiAgent Assist uses your signed-in identity and does not broaden your source-system permissions. MSX remains the system of record and authorization boundary.

### Is sample mode based on my MSX portfolio?

No. Sample mode uses bundled, sanitized demonstration data and does not make live MSX calls.
