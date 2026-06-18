/**
 * Metro config wrapped with NativeWind so `global.css` (Tailwind) is processed
 * and `className` styling works. `withNativeWind` injects the CSS transformer;
 * `input` points at the Tailwind entry stylesheet.
 *
 * The default Expo Metro config already enables monorepo-aware resolution
 * (watchFolders + node_modules resolution up the workspace), which this repo
 * relies on for the `@bowli/shared` workspace package.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
