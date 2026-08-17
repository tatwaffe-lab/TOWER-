import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    outDir: "dist",
    target: "es2020",
    chunkSizeWarningLimit: 2000,
    // Alte Artefakte werden nicht gelöscht (die Ausgabeordner-Rechte in dieser
    // Umgebung erlauben kein Entfernen). Die Dateinamen sind gehasht und
    // index.html verweist immer auf den aktuellen Build — Altdateien sind
    // unreferenziert und harmlos.
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      // Direkt auf die TypeScript-Quelle statt auf das kompilierte CJS:
      // Vite bündelt echtes ESM, das umgeht CJS/ESM-Interop-Kanten bei
      // Barrel-Re-Exports und macht `npm run dev` unabhängig davon, ob
      // `shared` vorher gebaut wurde.
      "@td/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
    // .ts vor .js auflösen. Im Repo liegen noch alte kompilierte .js-Dateien
    // neben den .ts-Quellen (Altlast aus einer früheren Build-Fehlkonfiguration,
    // die sich nicht löschen ließ). Ohne diese Reihenfolge würde Vite die
    // veralteten .js-Dateien bevorzugen und die Quellen verschatten.
    extensions: [".ts", ".tsx", ".mjs", ".js", ".mts", ".jsx", ".json"],
  },
});
