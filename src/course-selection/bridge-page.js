'use strict';
setTimeout(()=>{if(document.documentElement.dataset.bridgeAttached!=='true')document.getElementById('bridgeStatus').textContent='尚未检测到配套扩展，请按下方说明安装后刷新本页。';},2000);
document.getElementById('copyExtensionPath').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('extensionPath').textContent);document.getElementById('copyExtensionPath').textContent='路径已复制';}catch{document.getElementById('copyExtensionPath').textContent='请手动复制上方路径';}};
