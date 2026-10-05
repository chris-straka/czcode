import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cz.ccez.uk",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
