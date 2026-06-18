/**
 * Native entry point.
 *
 * `react-native-get-random-values` is imported FIRST, before anything that
 * could touch `crypto.getRandomValues`. The UUIDv7 generator in `db/id.ts`
 * (used for every client-generated primary key) relies on a working
 * `crypto.getRandomValues`, which React Native does not provide natively — this
 * polyfill installs it onto the global. It must run before any module that
 * generates an id at import time, so it sits at the very top of the entry.
 */
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import { App } from './App';

// `registerRootComponent` calls `AppRegistry.registerComponent('main', …)` and
// ensures the environment is set up appropriately for Expo Go / dev client.
registerRootComponent(App);
