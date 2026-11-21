import {fileURLToPath} from 'node:url';
import {rolldown} from 'rolldown';

const file = name => fileURLToPath(new URL('../' + name, import.meta.url));
const build = await rolldown({
  input: file('src/preview/pdf-pages.js'),
  transform: {define: {'import.meta': '{}'}},
});
try {
  await build.write({file: file('public/preview/pdf-pages.bundle.js'), format: 'iife', minify: true});
} finally {
  await build.close();
}
