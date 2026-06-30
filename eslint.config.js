// Expo SDK 56 · ESLint 9 (flat config) · TypeScript
// 基座:eslint-config-expo(已内置 TypeScript、React、React Hooks、import 支持)

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const typescriptEslint = require('@typescript-eslint/eslint-plugin');

module.exports = defineConfig([
  // 1) Expo 官方基座配置(放最前面)
  expoConfig,

  // 2) Prettier 集成:把格式问题作为 lint 报出来,并关掉与 Prettier 冲突的规则
  //    若不想用 Prettier,删掉这一行及第 2 步的依赖即可
  eslintPluginPrettierRecommended,

  // 3) 你自己的规则覆盖
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.d.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },
    rules: {
      // 未使用变量给 warning;以 _ 开头的参数/变量视为有意忽略
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // 生产代码里残留的 console 给 warning(允许 warn / error)
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // —— 可选:import 自动排序 ——
      // eslint-config-expo 已内置 eslint-plugin-import,可直接启用。
      // 若运行报找不到 import 插件,再单独装 eslint-plugin-import。
      // 'import/order': [
      //   'warn',
      //   {
      //     groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      //     'newlines-between': 'always',
      //     alphabetize: { order: 'asc', caseInsensitive: true },
      //   },
      // ],
    },
  },

  // 4) 忽略不该被 lint 的目录/文件
  {
    ignores: [
      'dist/*',
      'node_modules/*',
      'ios/*',
      'android/*',
      '.expo/*',
      'expo-env.d.ts',
      'babel.config.js',
      'metro.config.js',
      // 阿里云 FC 短信 Hook 是独立的 Node(CommonJS)服务，不归 Expo/RN lint 管
      'services/**',
    ],
  },
]);
