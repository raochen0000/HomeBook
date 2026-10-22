const fs = require('fs');
const path = require('path');
const { IOSConfig, withAppDelegate, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const MARKER = 'homebook-ios-scene-lifecycle';
const FACTORY_PROTOCOL = 'HomeBookReactNativeFactoryProvider';
const SCENE_CLASS = '$(PRODUCT_MODULE_NAME).SceneDelegate';

const LEGACY_STARTUP = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const SCENE_SOURCE = `internal import Expo
import React

/// 供 SceneDelegate 取回 AppDelegate 在启动时创建的 React Native factory。
protocol ${FACTORY_PROTOCOL}: AnyObject {
  var window: UIWindow? { get set }
  var reactNativeFactory: RCTReactNativeFactory? { get }
}

/// iOS 27 要求 UIScene。窗口在这里创建，React Native 启动进这个 scene 的窗口。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard
      let provider = UIApplication.shared.delegate as? ${FACTORY_PROTOCOL},
      let factory = provider.reactNativeFactory
    else {
      fatalError("SceneDelegate 需要 AppDelegate 遵守 ${FACTORY_PROTOCOL} 并创建 reactNativeFactory")
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    provider.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions(from: connectionOptions)
    )
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
    if let provider = UIApplication.shared.delegate as? ${FACTORY_PROTOCOL} {
      provider.window = nil
    }
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      let options = openURLOptions(from: context.options)
      _ = ExpoAppDelegateSubscriberManager.application(UIApplication.shared, open: context.url, options: options)
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = ExpoAppDelegateSubscriberManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

/// 冷启动的 URL 只出现在 connectionOptions 里。放进 launchOptions 后，Linking.getInitialURL() 才能读到。
private func launchOptions(from connectionOptions: UIScene.ConnectionOptions) -> [UIApplication.LaunchOptionsKey: Any]? {
  var options: [UIApplication.LaunchOptionsKey: Any] = [:]
  if let url = connectionOptions.urlContexts.first?.url {
    options[.url] = url
  }
  if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
    options[.userActivityDictionary] = [
      UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
      "UIApplicationLaunchOptionsUserActivityKey": activity,
    ]
  }
  return options.isEmpty ? nil : options
}

private func openURLOptions(from sceneOptions: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
  var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  if let sourceApplication = sceneOptions.sourceApplication {
    options[.sourceApplication] = sourceApplication
  }
  if let annotation = sceneOptions.annotation {
    options[.annotation] = annotation
  }
  options[.openInPlace] = sceneOptions.openInPlace
  return options
}
`;

function updateAppDelegate(contents) {
  let next = contents;
  const classLine = 'class AppDelegate: ExpoAppDelegate {';
  const sceneClassLine = `class AppDelegate: ExpoAppDelegate, ${FACTORY_PROTOCOL} {`;

  if (next.includes(classLine)) {
    next = next.replace(classLine, sceneClassLine);
  }
  if (!next.includes(FACTORY_PROTOCOL)) {
    throw new Error('AppDelegate 类声明已变化，无法声明 scene factory');
  }

  if (next.includes(LEGACY_STARTUP)) {
    next = next.replace(
      LEGACY_STARTUP,
      `    // ${MARKER}\n    // iOS 27 要求 UIScene。窗口和 React Native 由 SceneDelegate 创建。`,
    );
  } else if (!next.includes(MARKER)) {
    throw new Error('AppDelegate 里找不到原有的窗口启动代码，无法改成 scene 生命周期');
  }

  return next;
}

function withSceneDelegateSource(config) {
  return withXcodeProject(config, (nextConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(nextConfig.modRequest.projectRoot);
    const relativePath = path.join(projectName, 'SceneDelegate.swift');
    const absolutePath = path.join(nextConfig.modRequest.platformProjectRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, SCENE_SOURCE);

    if (!nextConfig.modResults.hasFile(relativePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativePath,
        groupName: projectName,
        project: nextConfig.modResults,
      });
    }
    return nextConfig;
  });
}

/**
 * Xcode 27 / iOS 27 在启动时要求 UIScene。SDK 56 的 prebuild 模板仍在
 * AppDelegate 里创建窗口，因此每次 prebuild 都改写成 scene 生命周期。
 */
module.exports = function withIosSceneLifecycle(config) {
  config = withAppDelegate(config, (nextConfig) => {
    nextConfig.modResults.contents = updateAppDelegate(nextConfig.modResults.contents);
    return nextConfig;
  });

  config = withInfoPlist(config, (nextConfig) => {
    const manifest = nextConfig.modResults.UIApplicationSceneManifest;
    const delegateName =
      manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0]?.UISceneDelegateClassName;
    if (manifest && delegateName !== SCENE_CLASS) {
      throw new Error('Info.plist 已有其他 UIApplicationSceneManifest，不能覆盖');
    }
    nextConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_CLASS,
          },
        ],
      },
    };
    return nextConfig;
  });

  return withSceneDelegateSource(config);
};
