import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initNativeBridge } from './native/initNativeBridge';
import {
  loadBleStabilityRemoteConfig,
  setupBleStabilityRemoteConfigAutoRefresh,
} from './utils/bleStabilityRemoteConfig';
import './styles/index.css';

initNativeBridge();

// Task #48: BLE 단절 안내 임계값 원격 설정 부트스트랩.
// 응답이 없거나 비어 있으면 기본값(`DEFAULT_BLE_STABILITY_*`)이 그대로 쓰인다.
// 렌더를 막지 않도록 fire-and-forget — 첫 트레이닝 진입 전에 보통 완료된다.
void loadBleStabilityRemoteConfig();

// Task #86: 한 번 로그인한 뒤 앱을 며칠씩 띄워 두는 사용자도 운영자가 새로 푸시한
// 임계값을 다음 로그인까지 기다리지 않고 받을 수 있도록, 포그라운드 복귀와
// 일정 주기마다 한 번 더 받는다. throttle 로 폭주는 방지된다.
setupBleStabilityRemoteConfigAutoRefresh();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
