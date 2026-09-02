import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.threesec.fm",
  appName: "3sec FM",
  webDir: "dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" },
};

export default config;
