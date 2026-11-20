import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR requires a secure context. basic-ssl lets a headset on the LAN open https://<ip>:5173.
// `NO_HTTPS=1 npm run dev` serves plain http (localhost is already a secure context).
const useHttps = ! process.env.NO_HTTPS;

export default defineConfig( {
	plugins: useHttps ? [ basicSsl() ] : [],
	build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
} );
