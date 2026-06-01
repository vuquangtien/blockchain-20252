import {defineConfig} from "vite";

export default defineConfig({
    server: {
        watch: {
            usePolling: true,
            interval: 500,
        },
    },
    build: {
        outDir: "dist-web",
        emptyOutDir: true,
    },
});
