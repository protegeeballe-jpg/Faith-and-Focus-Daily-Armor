# Main branch protection policy

The default branch is `main`. The connected GitHub integration available during this maintenance session can inspect branch protection but does not expose the repository-administration write operation needed to activate it. This file records the exact policy to enable in GitHub Settings → Branches (or Repository Rulesets).

Apply these rules to `main`:

- Require a pull request before merging.
- Require the `regression-security` status check from the `App regression and security tests` workflow.
- Require the branch to be up to date before merging.
- Require conversation resolution.
- Block force pushes and branch deletion.
- Do not require an approving review for the single-owner workflow; require the automated check instead.
- Do not grant routine bypass permission to workflows or users.

`.github/CODEOWNERS` identifies the repository owner for covered paths. A CODEOWNERS file does not itself activate branch protection or require review; the rules above must be enabled in GitHub's repository settings.

After enabling the rule, verify that a test pull request cannot merge while `regression-security` is pending or failing and can merge only after it succeeds.
