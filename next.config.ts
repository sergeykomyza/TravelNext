import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @xenova/transformers тянет нативный onnxruntime-node: его нельзя бандлить
  // (Turbopack не включает нативные .so/.node в serverless-функцию). Выносим
  // пакет как server-external, чтобы Vercel забрал нативные бинари из node_modules.
  serverExternalPackages: ['@xenova/transformers'],
  // ...но Vercel не трассирует нативные .so автоматически → dlopen падал с
  // "libonnxruntime.so.1.14.0: cannot open shared object file". Явно тащим
  // linux-бинари onnxruntime в bundle функции генерации плана.
  outputFileTracingIncludes: {
    '/api/generate-plan': ['./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/**/*'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
