import { terser } from "rollup-plugin-terser";

export default {
  input: "./dist/tsc/main.js",
  output: {
    dir: "dist",
    format: "cjs",
    indent: false,
  },
  plugins: [terser()],
};
