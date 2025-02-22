<p align="center">
  <a href="https://streamr.network">
    <img alt="Streamr" src="https://raw.githubusercontent.com/streamr-dev/network-monorepo/main/packages/client/readme-header.png" width="1320" />
  </a>
</p>

# Network

Monorepo containing all the main components of Streamr Network.

## Table of Contents
- [Packages](#packages)
- [NPM scripts](#npm-scripts)
- [Release](#release)

## Packages

### User-Facing
* [broker](packages/broker/README.md) (streamr-broker)
* [client](packages/client/README.md) (streamr-client)
* [cli-tools](packages/cli-tools/README.md) (@streamr/cli-tools)

### Internal
* [network-node](packages/network/README.md) (@streamr/network-node)
* [network-tracker](packages/network-tracker/README.md) (@streamr/network-tracker)
* [protocol](packages/protocol/README.md) (@streamr/protocol)
* [utils](packages/utils/README.md) (@streamr/utils)
* [test-utils](packages/test-utils/README.md) (@streamr/test-utils)

## NPM scripts
| Node.js `16.13.x` is the minimum required version. Node.js `18.12.x`, NPM `8.x` and later versions are recommended. |
|---------------------------------------------------------------------------------------------------------------------|

The monorepo is managed using [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces).

Installation on an Apple Silicon Mac requires additional steps, see [install-on-apple-silicon.md](/install-on-apple-silicon).

**Important:** Do not use `npm ci` or `npm install` directly in the sub-package directories.

### Bootstrap all sub-packages
The go-to command for most use cases.

To install all required dependencies and build all sub-packages (linking sub-packages together as needed):

```bash
# from top level
npm run bootstrap
```

###  Bootstrap a single sub-package

To install the required dependencies and build a specific sub-package:

```bash
# from top level
npm run bootstrap-pkg --package=$PACKAGE_NAME
```

### Install dependencies only

To only install required dependencies and link sub-packages together (and skip build phase):

```bash
# from top level
npm ci
```

### Build
To build all sub-packages:
```bash
# from top level
npm run build
```

### Build a sub-package
To build a specific sub-package:
```bash
# from top level
npm run build --workspace=$PACKAGE_NAME
```

### Clear caches and built files

To clear all caches and remove the `dist` directory from each sub-package:

```bash
# from top level
npm run clean-dist
```

### Clean all

To removes all caches, built files, and **`node_modules`** of each sub-package, and the
top-level **`node_modules`**:

```bash
# from top level
npm run clean
```

### Install git hooks
To install git hooks (e.g. Husky for conventional commit validation):

```bash
npm run install-git-hooks
```

### Add a dependency into a sub-package

Manually add the entry to the `package.json` of the sub-package and 
run `npm run bootstrap-pkg $PACKAGE_NAME`.

Alternatively, run:
```bash
npm install some-dependency --workspace=$PACKAGE_NAME
```

### List active versions & symlinks

Check which sub-packages are currently being symlinked.

```bash
# from top level
npm run versions
```

This lists sub-packages & their versions on the left, linked
sub-packages are columns.  If the package on the left links to the package
in the column, it shows a checkmark & the semver range, otherwise it
shows the mismatched semver range and prints a warning at the end.  It
prints the version ranges so you can double-check that they're formatted
as you expect e.g. `^X.Y.Z` vs `X.Y.Z`

![image](https://user-images.githubusercontent.com/43438/135347920-97d6e0e7-b86c-40ff-bfc9-91f160ae975c.png)

## Release

### utils, test-utils, protocol, network-tracker, network-node, client, cli-tools

All the above packages should be released at the same time.

1. `git checkout main`
2. `git pull`
3. `./update-versions.sh <SEMVER>` E.g. `./update-versions 7.1.1`
4. `npm run clean && npm install && npm run build && npm run versions`
5. Look at the output of the above and ensure all versions are linked properly (i.e. no yellow or red markers)
6. Update client and cli-tool CHANGELOG.md
7. If releasing a major / minor version, update API docs link in *packages/client/README.md*.
8. Add relevant files to git staging
9. `git commit -m "release(client, cli-tools): vX.Y.Z"`
10. `git tag client/vX.Y.Z`
11. `git tag cli-tools/vX.Y.Z`
12. Push to main `git push origin`
13. Push to tag `git push origin client/vX.Y.Z`
14. Push to tag `git push origin cli-tools/vX.Y.Z`
15. At this point we are to do the actual release
16. Clean and rebuild project with `npm run clean && npm run bootstrap`
17. Then we do actual publishing of packages with `./release.sh <NPM_TAG>`. Use argument `beta` if publishing a
beta version. Use `latest` instead when publishing a stable version.
18. Update client docs if major or minor change:
```bash

# Generate & upload API docs (if a major/minor version update)
cd packages/client
npm run docs
aws s3 cp ./docs s3://api-docs.streamr.network/client/vX.Y --recursive --profile streamr-api-docs-upload
```

### broker

Broker is released independently of other packages because it follows its own versioning
for the time being.

```
git checkout main
cd packages/broker
npm version <SEMVER_OPTION>
git add package.json
git commit -m "release(broker): vX.Y.Z"
git tag broker/vX.Y.Z
git push origin
git push origin broker/vX.Y.Z

npm run build
npm publish
```

#### Docker release

1. Go to https://github.com/streamr-dev/network/actions/workflows/release.yml
2. From "run workflow" dropdown:
   - select `main` branch
   - click "Run workflow"
3. You can manually cancel other queued workflows (triggered by possible previous commits to `main`)
4. After ~1 hour a new release is ready, annotated with `latest` tag: https://hub.docker.com/r/streamr/broker-node/tags
