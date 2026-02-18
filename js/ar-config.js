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
    showToggle: true,

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
    maxMarkers: 100,
    rebuildThresholdMeters: 30,
    minBuildIntervalMs: 1200,
    maxLabelChars: 26,
    arFieldYOffsetPx: 0,
    offscreenMargin: 48,
    laneStepDeg: 2.8,
    clusterStepDeg: 8.0,
    xScatterLaneWeight: 34,
    xScatterClusterWeight: 56,
    xScatterBaseFactor: 0.8,
    xScatterDistanceFactor: 1.2,
    yScatterLaneWeight: 17.5,
    yScatterClusterWeight: 30,
    yScatterBaseFactor: 0.4375,
    yScatterDistanceFactor: 0.6875,
    yScatterUpMultiplier: 2.76,
    yScatterDownMultiplier: 0.82,
    distanceYOffsetFactor: 0.32,
    tiltPivotRatio: 0.35,
    tiltReduceFactor: 0.52,
    tiltClampUpRatio: 0.14,
    tiltClampDownRatio: 0.14,
    targetYMinRatio: -0.12,
    targetYMaxRatio: 0.7,
    verticalSpreadScale: 0.5,
    autoAlignEnabled: 0,
    autoAlignTargetRatio: 0.49,
    autoAlignMaxShiftRatio: 0.14,
    autoAlignLerp: 0.35,
    rankTopRatio: 0.1,
    rankBottomRatio: 0.7,
    rankPerspectiveStrength: 3.0,
    rankScatterRatio: 0.02,
    screenXSmooth: 0.42,
    screenYSmooth: 0.22,
    markerBaseY: 1.8,
    markerSpreadStep: 0.45,
    markerDensityClusterFactor: 0.2,
    markerDensityLaneFactor: 0.1,
    markerDensityMaxAdd: 2.0,
    markerClusterOffsetWeight: 1.8,
    markerYMin: 0.6,
    markerYMax: 7.5,
    iconSizeMax: 38,
    iconSizeMin: 5,
    iconSizeDistanceFactor: 33,
    labelFontMax: 31,
    labelFontMin: 10,
    labelFontDistanceFactor: 34,
    iconOpacityStart: 0.98,
    iconOpacityDistanceFactor: 0.62,
    iconOpacityMin: 0.36,
    iconOpacityMax: 0.98,
    labelOpacityStart: 0.99,
    labelOpacityDistanceFactor: 0.34,
    labelOpacityMin: 0.65,
    labelOpacityMax: 0.99,
  },
};
