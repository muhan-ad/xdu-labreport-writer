import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { preparationUrl } from "../domain/preparation.ts";
export async function openPreparation(name: string) {
  const url = preparationUrl(name);
  if (Capacitor.isNativePlatform())
    await Browser.open({ url, toolbarColor: "#15803d" });
  else {
    // noopener intentionally returns null in some browsers even when opening succeeds.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
