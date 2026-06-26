<!--
Thanks for sending a patch. Keep this short; delete sections that do not apply.
See CONTRIBUTING.md for what lands easily and what needs an issue first.
-->

## What and why

<!-- One or two sentences on the user-visible change and the problem it solves. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New read-only tool
- [ ] New write tool / wider write blast radius (opened an issue first per CONTRIBUTING.md)
- [ ] Docs
- [ ] Refactor with no tool-surface change

## Checklist

- [ ] `npm test` and `npm run typecheck` pass locally
- [ ] Added or updated tests covering the change (including gate/refusal paths for any write tool)
- [ ] Updated the `Unreleased` section of `CHANGELOG.md` for any user-visible effect
- [ ] Updated the tool table and reference in `README.md` if a tool was added or changed
- [ ] No personal details, hostnames, IPs, account names, API keys, or unredacted absolute paths in code, tests, docs, or this PR (the `content-guard` check will flag them)
- [ ] Write tools stay behind `enableEdit`; credential writes behind `enableCredentialsWrite`; destructive tools honor `confirm: true`
- [ ] Conventional commit messages, no AI co-authorship trailers
