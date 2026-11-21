import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '^/__lab-data/(?:mobile-data-manifest\\.json|mobile-data/data-\\d+\\.\\d+\\.\\d+\\.json)$': {
        target: 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com',
        changeOrigin: true,
        rewrite: path => path.slice('/__lab-data'.length),
        proxyTimeout: 30000,
      },
    },
  },
});
