import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @xenova/transformers тянет нативный onnxruntime-node: его нельзя бандлить
  // (Turbopack не включает нативные .so/.node в serverless-функцию). Выносим
  // пакет как server-external, чтобы Vercel забрал нативные бинари из node_modules.
  serverExternalPackages: ['@xenova/transformers'],
};

export default nextConfig;
