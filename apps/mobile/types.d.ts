/**
 * Ambient module declarations for non-TS assets imported by the Expo app.
 *
 * - `*.sql`: Drizzle's generated `drizzle/migrations.js` bundle imports each
 *   migration `.sql` as a module; Metro's expo-sqlite transformer turns these
 *   into string exports at bundle time. TypeScript needs the shape declared.
 * - the `drizzle/migrations` glob: the generated Expo migration bundle consumed
 *   by `drizzle-orm/expo-sqlite/migrator`'s `useMigrations`.
 */
declare module '*.sql' {
  const content: string;
  export default content;
}

declare module '*/drizzle/migrations' {
  const bundle: {
    journal: {
      entries: {
        idx: number;
        when: number;
        tag: string;
        breakpoints: boolean;
      }[];
    };
    migrations: Record<string, string>;
  };
  export default bundle;
}
