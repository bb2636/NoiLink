import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initNativeBridge } from './native/initNativeBridge';
import { loadBleStabilityRemoteConfig } from './utils/bleStabilityRemoteConfig';
import './styles/index.css';

initNativeBridge();

// Task #48: BLE 단절 안내 임계값 원격 설정 부트스트랩.
// 응답이 없거나 비어 있으면 기본값(`DEFAULT_BLE_STABILITY_*`)이 그대로 쓰인다.
// 렌더를 막지 않도록 fire-and-forget — 첫 트레이닝 진입 전에 보통 완료된다.
void loadBleStabilityRemoteConfig();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
