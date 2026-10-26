import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsxFactory: 'createElement',
    jsxFragment: 'createFragment',
    jsxInject: `import { createElement } from 'inferno-create-element'; import { createFragment } from 'inferno';`,
  },
});
