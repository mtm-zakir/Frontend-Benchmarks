import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		cssMinify: 'esbuild',
	},
	environments: {
		ssr: {
			build: {
				cssMinify: 'esbuild',
			},
		},
		client: {
			build: {
				cssMinify: 'esbuild',
			},
		},
	},
});
