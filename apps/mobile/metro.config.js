// Monorepo-aware Metro config for Expo + pnpm.
// Resolves modules from app + workspace root so `@split-wise/shared` etc. work.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo for changes to workspace packages.
config.watchFolders = [workspaceRoot];

// Resolve node_modules in app first, then workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm hoists nothing — disable hierarchical lookup so resolution is deterministic.
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
