/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * Custom Next.js Standalone Server with Unix Socket Support
 *
 * This wrapper allows the Next.js standalone server to listen on either
 * a TCP port (development) or a Unix socket (production via cloudflared).
 *
 * Environment variables:
 *   SOCKET_PATH - Unix socket path (takes precedence)
 *   PORT - TCP port (default: 6001)
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const net = require("net");

// Set production mode
process.env.NODE_ENV = "production";

// Determine the standalone directory
const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
process.chdir(standaloneDir);

// Load Next.js config
const nextConfig = require(path.join(standaloneDir, ".next", "required-server-files.json")).config;
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

// Get connection options
const socketPath = process.env.SOCKET_PATH;
const internalPort = 0; // Use ephemeral port for internal Next.js server
const externalPort = parseInt(process.env.PORT, 10) || 6001;
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Import Next.js server
require("next");
const { startServer } = require("next/dist/server/lib/start-server");

async function main() {
  // Clean up stale socket if exists
  if (socketPath && fs.existsSync(socketPath)) {
    console.log(`Removing stale socket: ${socketPath}`);
    fs.unlinkSync(socketPath);
  }

  if (socketPath) {
    // Socket mode: Start Next.js on internal port, proxy from socket
    // Find an available port
    const getAvailablePort = () => new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });

    const internalPort = await getAvailablePort();

    // Start Next.js on the internal port
    const nextServer = await startServer({
      dir: standaloneDir,
      isDev: false,
      config: nextConfig,
      hostname: "127.0.0.1",
      port: internalPort,
      allowRetry: false,
    });

    // Create a proxy server that listens on the socket
    const proxyServer = http.createServer((req, res) => {
      const options = {
        hostname: "127.0.0.1",
        port: internalPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on("error", (err) => {
        console.error("Proxy error:", err.message);
        res.writeHead(502);
        res.end("Bad Gateway");
      });

      req.pipe(proxyReq, { end: true });
    });

    // Handle WebSocket upgrades
    proxyServer.on("upgrade", (req, socket, head) => {
      const options = {
        hostname: "127.0.0.1",
        port: internalPort,
        path: req.url,
        method: "GET",
        headers: req.headers,
      };

      const proxyReq = http.request(options);
      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n` +
          Object.entries(proxyRes.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n") +
          "\r\n\r\n"
        );
        if (proxyHead.length > 0) {
          socket.write(proxyHead);
        }
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });

      proxyReq.on("error", (err) => {
        console.error("WebSocket proxy error:", err.message);
        socket.destroy();
      });

      proxyReq.end();
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`\n${signal} received, shutting down...`);
      proxyServer.close(() => {
        if (socketPath && fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    proxyServer.listen(socketPath, () => {
      // Set socket permissions
      fs.chmodSync(socketPath, 0o666);
      console.log(`▲ Next.js (Socket Mode)`);
      console.log(`- Internal: http://127.0.0.1:${internalPort}`);
      console.log(`- Socket: ${socketPath}`);
      console.log(`✓ Ready`);
    });
  } else {
    // Port mode: Use default Next.js server
    await startServer({
      dir: standaloneDir,
      isDev: false,
      config: nextConfig,
      hostname,
      port: externalPort,
      allowRetry: false,
    });

    console.log(`▲ Next.js`);
    console.log(`- Local: http://localhost:${externalPort}`);
    console.log(`- Network: http://${hostname}:${externalPort}`);
    console.log(`✓ Ready`);
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
