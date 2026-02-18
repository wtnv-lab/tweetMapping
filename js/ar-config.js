window.AR_CONFIG = {
  // 読み込むツイートデータ(CZML)のパス
  tweetDataUrl: "data/czml/tweets.json",

  // マーカーに使うTwitterアイコン画像のパス
  twitterIconUrl: "data/icon/flags/twitter.png",

  // 位置情報の再取得間隔（ミリ秒）
  locationPollIntervalMs: 5000,

  // 権限許可のキャッシュキー（localStorage）
  permissionCacheKey: "tweetMappingArPermissionGrantedAt",

  // 権限許可のキャッシュ有効期間（ミリ秒）
  permissionCacheWindowMs: 30 * 24 * 60 * 60 * 1000,

  debug: {
    // 初期状態でデバッグモード(固定座標)を使うか
    // false: 通常の現在地を使う / true: testLocationを使う
    // デフォルトはOFF(false)
    useTestLocationByDefault: false,

    // DEBUGスイッチUIを表示するか
    showToggle: false,

    // DEBUGスイッチON時に使う固定座標
    // 仙台市役所付近: 緯度 38.268721, 経度 140.869407
    testLocation: {
      lat: 38.268721,
      lon: 140.869407,
    },
  },

  geolocation: {
    // 端末の現在地取得オプション
    enableHighAccuracy: false,
    maximumAgeMs: 5000,
    timeoutMs: 30000,
  },

  // ARマーカーの見え方・配置を調整する表示パラメータ
  displaySettings: {
    // マーカ分布の上端・下端
    verticalRangeTopRatio: 0.0,
    verticalRangeBottomRatio: 0.8,
    // マーカ（ラベル）サイズの最大値・最小値
    iconSizeMinPx: 5,
    iconSizeMaxPx: 38,
    labelSizeMinPx: 10,
    labelSizeMaxPx: 31,
    // マーカ（ラベル）透明度の最大値・最小値
    iconOpacityMin: 0.36,
    iconOpacityMax: 0.98,
    labelOpacityMin: 0.65,
    labelOpacityMax: 0.99,
    // 変化率（非線形）
    nonLinearExponent: 0.36,
    // スマホのティルトに追従して上下動する幅
    tiltFollowShiftRatio: 0.06,
    // スマホのティルトに追従してマーカ間隔を拡大する率
    tiltSpacingFactor: 3.0,
  },
};
