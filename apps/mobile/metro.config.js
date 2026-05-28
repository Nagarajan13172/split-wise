// Monorepo-aware Metro config for Expo + pnpm.
// Follows the official Expo monorepo recipe: watch the whole workspace, and add
// both the app's and the workspace root's node_modules to the resolver paths.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the entire monorepo so workspace package edits trigger HMR.
config.watchFolders = [workspaceRoot];

// 2. Resolve node_modules from the app first, then the workspace root.
//    pnpm uses a content-addressable .pnpm store + symlinks; both these paths
//    point at the symlink trees that pnpm sets up.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Required for pnpm: Metro must follow the symlinks pnpm creates.
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: './global.css' });
