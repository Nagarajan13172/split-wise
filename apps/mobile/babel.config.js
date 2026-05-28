module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // NativeWind v4 + babel-preset-expo: setting jsxImportSource is sufficient.
      // The separate `nativewind/babel` preset is for v2; on v4 it pulls in
      // react-native-worklets which is incompatible with RN 0.76 (SDK 52).
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
  };
};
