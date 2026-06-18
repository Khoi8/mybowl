/**
 * Root React component. Intentionally thin: it only mounts the provider tree
 * (TanStack Query + migration bootstrap) around the navigation skeleton. All
 * real screens live under `src/features/**` and are reached via `navigation`.
 */
import './global.css';

import { Providers } from './src/app/providers';
import { RootNavigation } from './src/app/navigation';

export function App(): React.JSX.Element {
  return (
    <Providers>
      <RootNavigation />
    </Providers>
  );
}

export default App;
