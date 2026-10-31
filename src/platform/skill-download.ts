import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { copyReportText } from './clipboard.ts';

// Same public sharing address as desktop renderer.js (SKILL_PAN_URL).
// Only an explicit user action opens it; never fetch or auto-import its contents.
export const skillDownloadUrl = 'https://pan.baidu.com/s/1UzAla9IiEZ2KZ-Dvdtp_aA?pwd=f2dh';
export const skillDownloadCode = 'f2dh';
export const skillDownload = {
  copy: () => copyReportText(skillDownloadUrl),
  async open() {
    if (Capacitor.isNativePlatform()) await Browser.open({ url: skillDownloadUrl, toolbarColor: '#15803d' });
    else window.open(skillDownloadUrl, '_blank', 'noopener,noreferrer');
  },
};
