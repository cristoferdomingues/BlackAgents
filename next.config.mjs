/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Electron packages this self-contained server under resources/server.
  output: "standalone",
}

export default nextConfig
