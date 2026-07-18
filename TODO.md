# TODO

## npm publish setup for `coco-research/coco` — one-time manual (only you can do this)

These require your npm/GitHub account and can't be automated by an agent.

- [ ] **npm account + scope** — sign in at [npmjs.com](https://www.npmjs.com) with an account that
      owns (or is a member of) the `@coco-research` org/scope. If that org doesn't exist on npm yet,
      create it — otherwise the scoped publish will fail even with a valid token.
- [ ] **Generate an Automation token** — npmjs.com → Access Tokens → **Automation** type
      (bypasses 2FA in CI).
- [ ] **Add it as a repo secret** — in `coco-research/coco`: Settings → Secrets and variables →
      Actions → New repository secret, named exactly **`NPM_TOKEN`**.
