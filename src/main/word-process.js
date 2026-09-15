// Fail closed: only terminate the process still owning the recorded Word document window.
const cleanupScript = [
  'import sys, json, win32api, win32process',
  'for pid, hwnd in json.loads(sys.argv[1]):',
  '    handle = None',
  '    try:',
  '        if win32process.GetWindowThreadProcessId(hwnd)[1] != pid: continue',
  '        handle = win32api.OpenProcess(1, False, pid)',
  '        if win32process.GetWindowThreadProcessId(hwnd)[1] == pid:',
  '            win32api.TerminateProcess(handle, 1)',
  '    except Exception: pass',
  '    finally:',
  '        if handle is not None: handle.Close()',
].join('\n');

module.exports = { cleanupScript };
