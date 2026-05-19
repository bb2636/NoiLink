const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// expo-doctor 권장: `disableHierarchicalLookup` 은 기본값(false) 유지.
// nodeModulesPaths 만 명시해 모노레포 의존성을 해석하고, 상위 디렉토리
// fallback 은 Metro 가 알아서 처리하게 둔다. true 로 강제하면 일부
// 라이브러리의 동적 require 가 깨질 수 있다.

module.exports = config;
