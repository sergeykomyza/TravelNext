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
};

export default nextConfig;
