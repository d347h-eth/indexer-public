# Yarn Workspaces Setup (Yarn 4)

## Workspace Linking

- Local packages are referenced via the workspace protocol with explicit versions:
  - `packages/indexer/package.json`
    - `"@reservoir0x/mint-interface": "workspace:^0.0.1"`
    - `"@reservoir0x/sdk": "workspace:^0.0.372"`
  - `packages/contracts/package.json`
    - `"@reservoir0x/sdk": "workspace:^0.0.372"`

This prevents Yarn from attempting to fetch unpublished packages from the registry.

## Tooling Pins

- Root `package.json`:
  - `"packageManager": "yarn@4.9.4"`
- Root `.yarnrc.yml`:
  - `nodeLinker: node-modules`
  - `enableImmutableInstalls: false`
  - `enableGlobalCache: true`
  - `nmMode: hardlinks-local`
  - `progressBarStyle: default`

## Commands

- Always install from repo root:
  - `yarn install`
  - `yarn build`
  - `yarn start`

## Common Issues

- `Workspace not found`: run installs at the repo root; ensure workspace protocol is used (not `*`).
- Lockfile mismatch during `turbo run`: perform a fresh root `yarn install` to update workspace descriptors.
- Invalid progress bar style: use `progressBarStyle: default` on Yarn 4.

