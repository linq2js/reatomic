import { terser } from "rollup-plugin-terser";

export default [
  {
    input: "./dist/tsc/main.js",
    output: {
      dir: "dist",
      format: "cjs",
      indent: false,
    },
    plugins: [terser()],
  },
  {
    input: "./dist/tsc/concurrency/index.js",
    output: {
      dir: "dist/concurrency",
      format: "cjs",
      indent: false,
    },
    plugins: [terser()],
  },
  {
    input: "./dist/tsc/hydration/index.js",
    output: {
      dir: "dist/hydration",
      format: "cjs",
      indent: false,
    },
    plugins: [terser()],
  },
];
