import UIAbility from '@ohos.app.ability.UIAbility';
import hilog from '@ohos.hilog';
import window from '@ohos.window';

/**
 * 绿角犀 Office · HarmonyOS 入口 Ability
 * 仅负责把 pages/Index 加载到窗口；页面内用 Web 组件承载 Web 应用。
 */
export default class EntryAbility extends UIAbility {
  onCreate(want, launchParam) {
    hilog.info(0x0000, 'LJX', '%{public}s', 'Ability onCreate');
  }

  onDestroy() {
    hilog.info(0x0000, 'LJX', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'LJX', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
      }
    });
  }

  onWindowStageDestroy() {
    // 释放资源
  }

  onForeground() {
    // 切前台
  }

  onBackground() {
    // 切后台
  }
}
