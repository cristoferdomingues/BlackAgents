/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Electron packages this self-contained server under resources/server.
  output: "standalone",
  // The wake-word model is loaded in the browser. If the server traces it,
  // keep the Node builds of these packages outside the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
}

export default nextConfig
