import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR requires a secure context. basic-ssl lets a headset on the LAN open https://<ip>:5173.
// `NO_HTTPS=1 npm run dev` serves plain http (localhost is already a secure context).
const useHttps = ! process.env.NO_HTTPS;

// GitHub Pages deploys under a subpath (/<repo>), so CI passes the real paths in.
// Locally the app is served from the dev-server root and the OGP tags point at the
// published site (absolute URLs are required by scrapers).
const basePath = ( () => {

	const trimmed = ( process.env.BASE_PATH ?? '' ).replace( /^\/+|\/+$/g, '' );
	return trimmed ? `/${ trimmed }/` : '/';

} )();
const siteUrl = ( process.env.SITE_URL ?? 'https://webxr-jp.github.io/webxr-webgpu-renderpipeline-demo' ).replace( /\/+$/, '' );

// Absolute URLs are required by OGP/Twitter cards, so the canonical site URL is
// injected at build time instead of being hard-coded.
const ogpSiteUrl = {
	name: 'ogp-site-url',
	transformIndexHtml( html ) {
		return html.replaceAll( '__SITE_URL__', siteUrl );
	},
};

export default defineConfig( {
	base: basePath,
	plugins: [ ...( useHttps ? [ basicSsl() ] : [] ), ogpSiteUrl ],
	build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
} );
