import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["cjs", "esm"], // Build for commonJS and ESmodules
  dts: true, // Generate declaration files
  sourcemap: true, // Generate source maps
  clean: true, // Clean the output directory before building
});
