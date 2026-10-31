import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.labmaker.app",
  appName: "实验搭子",
  webDir: "dist",
  loggingBehavior: "none",
  android: { allowMixedContent: false },
};
export default config;
