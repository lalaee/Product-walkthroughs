// Builds Design to AI's plugin interface (github.com/lalaee/DesigntoAI-Plugin-Cloud) with Vite, as its
// own `npm run build:ui` does, with one change: the bare `framer-plugin` import resolves to
// framer-standin.js, so the interface runs in a page instead of inside Framer. esbuild's wasm (the
// plugin bundles the exported components in the browser) is served next to the page rather than from
// unpkg. Usage: node flows/designtoai-web/build.mjs [plugin checkout] [out dir]
import {join, resolve} from 'node:path';
import {copyFileSync} from 'node:fs';

const HERE = import.meta.dirname;
const PLUGIN = resolve(process.argv[2] ?? process.env.DESIGNTOAI_PLUGIN ?? join(HERE, '../../../designtoai-plugin-cloud'));
const OUT = resolve(process.argv[3] ?? join(HERE, '../../out/designtoai-web'));

const {build} = await import(join(PLUGIN, 'node_modules/vite/dist/node/index.js'));
const {default: react} = await import(join(PLUGIN, 'node_modules/@vitejs/plugin-react/dist/index.js'));

await build({
  root: PLUGIN,
  configFile: false,
  logLevel: 'warn',
  base: '/plugin/',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __ESBUILD_WASM_URL__: JSON.stringify('/plugin/esbuild.wasm')
  },
  plugins: [react()],
  resolve: {alias: [
    {find: /^framer-plugin$/, replacement: join(HERE, 'framer-standin.js')},
    {find: '@', replacement: join(PLUGIN, 'src')}
  ]},
  esbuild: {target: 'esnext'},
  build: {outDir: OUT, emptyOutDir: true, target: 'esnext', rollupOptions: {input: join(PLUGIN, 'index.html')}}
});
copyFileSync(join(PLUGIN, 'node_modules/esbuild-wasm/esbuild.wasm'), join(OUT, 'esbuild.wasm'));
console.log(`built → ${OUT}`);
