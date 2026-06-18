/**
 * Babel config for the Expo app. `jsxImportSource: 'nativewind'` lets NativeWind
 * transform `className` props on RN components. The `nativewind/babel` preset
 * and the reanimated plugin (which MUST be listed last) complete the setup.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};
