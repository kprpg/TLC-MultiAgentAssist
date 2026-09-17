import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Bundles the extension host entry to CommonJS for the VS Code extension host (Node).
// SSR/node resolution avoids browser builds of dependencies (e.g. docx referencing `document`).
// `noExternal` bundles all dependencies so the VSIX is self-contained; `vscode` and Node
// built-ins stay external and resolve at runtime.
export default defineConfig({
    ssr: {
        noExternal: true
    },
    build: {
        outDir: resolve(__dirname, 'dist/host'),
        emptyOutDir: true,
        sourcemap: true,
        target: 'node18',
        minify: false,
        ssr: resolve(__dirname, 'src/extension.ts'),
        rollupOptions: {
            external: (id) => id === 'vscode' || id.startsWith('node:'),
            output: {
                format: 'cjs',
                entryFileNames: 'extension.cjs',
                inlineDynamicImports: true
            }
        }
    }
})
