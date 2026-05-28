// vite.config.ts
import { defineConfig } from "file:///Users/nagarajan/playground/split-wise/apps/web/node_modules/vite/dist/node/index.js";
import react from "file:///Users/nagarajan/playground/split-wise/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "node:path";
var __vite_injected_original_dirname = "/Users/nagarajan/playground/split-wise/apps/web";
var vite_config_default = defineConfig({
  plugins: [react()],
  // Load the root .env so a single file fuels both API and web (VITE_* vars only).
  envDir: path.resolve(__vite_injected_original_dirname, "../.."),
  resolve: {
    alias: { "@": path.resolve(__vite_injected_original_dirname, "./src") }
  },
  server: {
    port: 5173,
    // Bind to all interfaces so a phone on the same WiFi can reach the web app
    // (e.g. for verify-email / reset-password links that open in the phone browser).
    host: true,
    proxy: {
      "/trpc": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbmFnYXJhamFuL3BsYXlncm91bmQvc3BsaXQtd2lzZS9hcHBzL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL25hZ2FyYWphbi9wbGF5Z3JvdW5kL3NwbGl0LXdpc2UvYXBwcy93ZWIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL25hZ2FyYWphbi9wbGF5Z3JvdW5kL3NwbGl0LXdpc2UvYXBwcy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIC8vIExvYWQgdGhlIHJvb3QgLmVudiBzbyBhIHNpbmdsZSBmaWxlIGZ1ZWxzIGJvdGggQVBJIGFuZCB3ZWIgKFZJVEVfKiB2YXJzIG9ubHkpLlxuICBlbnZEaXI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLicpLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHsgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIC8vIEJpbmQgdG8gYWxsIGludGVyZmFjZXMgc28gYSBwaG9uZSBvbiB0aGUgc2FtZSBXaUZpIGNhbiByZWFjaCB0aGUgd2ViIGFwcFxuICAgIC8vIChlLmcuIGZvciB2ZXJpZnktZW1haWwgLyByZXNldC1wYXNzd29yZCBsaW5rcyB0aGF0IG9wZW4gaW4gdGhlIHBob25lIGJyb3dzZXIpLlxuICAgIGhvc3Q6IHRydWUsXG4gICAgcHJveHk6IHtcbiAgICAgICcvdHJwYyc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo0MDAwJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStULFNBQVMsb0JBQW9CO0FBQzVWLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFGakIsSUFBTSxtQ0FBbUM7QUFJekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBO0FBQUEsRUFFakIsUUFBUSxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLEVBQ3ZDLFNBQVM7QUFBQSxJQUNQLE9BQU8sRUFBRSxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPLEVBQUU7QUFBQSxFQUNqRDtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBO0FBQUE7QUFBQSxJQUdOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFNBQVM7QUFBQSxRQUNQLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
