import {readFileSync} from "node:fs";
import {defineConfig} from "vite";

const {revision} = JSON.parse(readFileSync(new URL("./public/prompter/release.json", import.meta.url), "utf8"));
export default defineConfig({
  base: "./",
  define: {__PROMPTER_REVISION__: JSON.stringify(revision)},
});
