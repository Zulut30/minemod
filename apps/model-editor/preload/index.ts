import { contextBridge, ipcRenderer } from "electron";
import type { EditorBridge } from "../shared/bridge.ts";
const bridge: EditorBridge = {
  request: (request) => ipcRenderer.invoke("studio:request", request),
  onState: (callback) => {
    const listener = (_event: unknown, value: Parameters<typeof callback>[0]) =>
      callback(value);
    ipcRenderer.on("studio:state", listener);
    return () => ipcRenderer.removeListener("studio:state", listener);
  },
  onAgentStatus: (callback) => {
    const listener = (_event: unknown, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on("studio:agent-status",listener);
    return () => ipcRenderer.removeListener("studio:agent-status",listener);
  },
  selection: (value) => ipcRenderer.invoke("studio:selection", value),
  onCapture: (callback) => {
    const listener = (_event: unknown, value: Parameters<typeof callback>[0]) =>
      callback(value);
    ipcRenderer.on("studio:capture", listener);
    return () => ipcRenderer.removeListener("studio:capture", listener);
  },
  captureReady: (id, failed = false) => ipcRenderer.send("studio:capture-ready", id, failed),
};
contextBridge.exposeInMainWorld("studio", bridge);
