// preload.js — 预加载脚本，暴露安全的 IPC 接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labAPI', {
  credentialStatus: () => ipcRenderer.invoke('credential-status'),
  saveCredential: (payload) => ipcRenderer.invoke('credential-save', payload),
  visionCredentialStatus: () => ipcRenderer.invoke('vision-credential-status'),
  saveVisionCredential: (payload) => ipcRenderer.invoke('vision-credential-save', payload),
  resolveEndpoints: (payload) => ipcRenderer.invoke('resolve-endpoints', payload),
  pickTableImage: () => ipcRenderer.invoke('pick-table-image'),
  saveTableImage: (expPath, dataUrl) => ipcRenderer.invoke('save-table-image', expPath, dataUrl),
  ocrRecognize: (params) => ipcRenderer.invoke('ocr-recognize', params),
  reportText: (filePath) => ipcRenderer.invoke('report-text', filePath),
  scanExperiments: () => ipcRenderer.invoke('scan-experiments'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  runGenerate: (expPath, studentInfo, variants, polish, embedDataPhoto) => ipcRenderer.invoke('run-generate', expPath, studentInfo, variants, polish, embedDataPhoto),
  cancelGenerate: () => ipcRenderer.invoke('cancel-generate'),
  onGenerateLog: (callback) => {
    ipcRenderer.on('generate-log', (_, data) => callback(data));
  },
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  // 方式三：schema/data 读写（表单模式）
  readSchema: (expPath) => ipcRenderer.invoke('read-schema', expPath),
  readData: (expPath) => ipcRenderer.invoke('read-data', expPath),
  readSampleData: (expPath) => ipcRenderer.invoke('read-sample-data', expPath),
  writeData: (expPath, data) => ipcRenderer.invoke('write-data', expPath, data),
  readRag: (expPath) => ipcRenderer.invoke('read-rag', expPath),
  readSections: (expPath) => ipcRenderer.invoke('read-sections', expPath),
  // 感谢声明名单（common/credits.json，随实验数据更新推送）
  readCredits: () => ipcRenderer.invoke('read-credits'),
  // 报告管理（设置页）
  listReports: () => ipcRenderer.invoke('list-reports'),
  deleteReport: (filePath) => ipcRenderer.invoke('delete-report', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  // AI 润色技能文件（userData/skills）
  listSkills: () => ipcRenderer.invoke('list-skills'),
  importSkill: () => ipcRenderer.invoke('import-skill'),
  deleteSkill: (id) => ipcRenderer.invoke('delete-skill', id),
  openSkillsFolder: () => ipcRenderer.invoke('open-skills-folder'),
  // 报告预览
  docxToHtml: (filePath) => ipcRenderer.invoke('docx-to-html', filePath),
  readDocxBuffer: (filePath) => ipcRenderer.invoke('read-docx-buffer', filePath),
  // 内置音频（彩蛋播放）
  readAudioFile: () => ipcRenderer.invoke('read-audio-file'),
  // 检查更新（仅版本校对 + 浏览器打开下载链接）
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: (cfg) => ipcRenderer.invoke('check-for-update', cfg),
  copyLink: (url) => ipcRenderer.invoke('copy-link', url),
  openDataFile: (expPath) => ipcRenderer.invoke('open-data-file', expPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // 贡献数据上传（COS 直传）
  contributeGetCredentials: (payload) => ipcRenderer.invoke('contribute-get-credentials', payload),
  contributeUpload: (payload) => ipcRenderer.invoke('contribute-upload', payload),
  // 实验数据热更新（免重装）
  getDataInfo: () => ipcRenderer.invoke('get-data-info'),
  checkDataUpdate: () => ipcRenderer.invoke('check-data-update'),
  downloadDataPackage: (payload) => ipcRenderer.invoke('download-data-package', payload),
  applyDataPackage: (payload) => ipcRenderer.invoke('apply-data-package', payload),
  cancelDataDownload: () => ipcRenderer.send('cancel-data-download'),
  onDataProgress: (callback) => {
    ipcRenderer.removeAllListeners('data-update-progress');   // 防多次注册累积
    ipcRenderer.on('data-update-progress', (_, data) => callback(data));
  },
  // AI 对话（requestId 支持取消：ai-chat-cancel 中止对应请求；onAiChunk 实时增量显示）
  aiChat: (params) => ipcRenderer.invoke('ai-chat', params),
  aiChatCancel: (requestId) => ipcRenderer.send('ai-chat-cancel', requestId),
  ocrCancel: (requestId) => ipcRenderer.send('ocr-cancel', requestId),
  onAiChunk: (cb) => {
    ipcRenderer.removeAllListeners('ai-chat-chunk');
    ipcRenderer.on('ai-chat-chunk', (_e, d) => { try { cb(d); } catch (e) { /* 忽略 */ } });
  },
  // 变体组合
  loadVariants: (expPath) => ipcRenderer.invoke('load-variants', expPath),
  saveVariants: (expPath, variants) => ipcRenderer.invoke('save-variants', expPath, variants),
  // 变体管理：实验级章节开关
  readSectionsConfig: (expPath) => ipcRenderer.invoke('read-sections-config', expPath),
  writeSectionsConfig: (expPath, disabled) => ipcRenderer.invoke('write-sections-config', expPath, disabled),
  // AI 润色导入判定：实验结果分析等非变体章节是否支持导入
  sectionImportable: (expPath, section) => ipcRenderer.invoke('section-importable', expPath, section),
  // 用户自建变体库
  listCustomVariants: () => ipcRenderer.invoke('list-custom-variants'),
  readCustomVariants: (expId) => ipcRenderer.invoke('read-custom-variants', expId),
  saveCustomVariant: (expId, section, text) => ipcRenderer.invoke('save-custom-variant', expId, section, text),
  deleteCustomVariant: (expId, section, index) => ipcRenderer.invoke('delete-custom-variant', expId, section, index),
  exportCustomVariants: (payload) => ipcRenderer.invoke('export-custom-variants', payload),
  importCustomVariants: () => ipcRenderer.invoke('import-custom-variants'),
  // 诊断日志导出（设置-开发者调试）
  exportDiagnostics: (payload) => ipcRenderer.invoke('export-diagnostics', payload),
  // 渲染进程事件转发到主进程日志
  logEvent: (msg) => ipcRenderer.send('log-event', msg),
  // 关闭前未保存提示
  setDataModified: (dirty) => ipcRenderer.send('data-modified', dirty),
  onSaveAndClose: (callback) => {
    ipcRenderer.on('app-save-and-close', () => callback());
  },
  confirmClose: () => ipcRenderer.send('app-confirm-close'),
});
