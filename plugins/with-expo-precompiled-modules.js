const { withPodfileProperties } = require('expo/config-plugins');

/**
 * Expo SDK 56 + 本项目的 @expo/ui 组合在预编译 ExpoModulesCore 下会发生 dyld 缺符号。
 * 通过标准 Podfile properties mod 固化为源码编译；每次 CNG / EAS prebuild 都会重写此文件，
 * 因而不能只手动改 ios/Podfile.properties.json。
 */
module.exports = function withExpoPrecompiledModules(config) {
  return withPodfileProperties(config, (nextConfig) => {
    nextConfig.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return nextConfig;
  });
};
