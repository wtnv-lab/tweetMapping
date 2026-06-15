(function () {
  const appConfig = window.APP_CONFIG || {};
  const googleMapsApiKey = appConfig.googleMapsApiKey || "";
  const cesiumIonToken = appConfig.cesiumIonToken || "";
  const cesiumGoogleMapsApiKey = appConfig.cesiumGoogleMapsApiKey || "";
  const viewPointsArray = appConfig.viewPoints || [
    { label: "日本全体", lat: 34.00934, lng: 135.843524, heading: -47, pitch: -50, range: 2000000 },
    { label: "東京都", lat: 35.67623749668245, lng: 139.75142329682316, heading: 0, pitch: -60, range: 30000 },
    { label: "皇居", lat: 35.6835836, lng: 139.7508397, heading: 0, pitch: -55, range: 2000 },
  ];
  const tilesetIonAssetId = appConfig.tilesetIonAssetId || 2275207;

  if (googleMapsApiKey) {
    const googleMapsScript = document.createElement("script");
    googleMapsScript.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      googleMapsApiKey +
      "&callback=initMap&loading=async";
    googleMapsScript.async = true;
    googleMapsScript.defer = true;
    window.initMap = function () {};
    document.head.appendChild(googleMapsScript);
  }

  if (cesiumIonToken) {
    Cesium.Ion.defaultAccessToken = cesiumIonToken;
  }
  if (cesiumGoogleMapsApiKey) {
    Cesium.GoogleMaps.defaultApiKey = cesiumGoogleMapsApiKey;
  }

  const cesiumContainerDiv = document.getElementById("cesiumContainer");
  const blackOutDiv = document.getElementById("blackOut");
  const loadingDiv = document.getElementById("twCounter");
  const tweetMessageDiv = document.getElementById("tweetMessage");
  const geoButtonDiv = document.getElementById("buttonGeo");

  let viewer;
  let photogrammetryTilesetPromise = null;
  let photogrammetryTileset = null;
  let tweetDisplayToneEnabled = false;
  let baseImageryLayer = null;
  let userLocationPointCollection = null;
  let userLocationGlowPoint = null;
  let userLocationCorePoint = null;

  const baseBrightnessDefault = 1.0;
  const baseBrightnessTweetDisplay = 0.5;

  const tweetTileIndexUrl = "data/czml/tweet-tiles/index.json";
  const tweetSearchIndexUrl = "data/czml/tweet-tiles/search.json";
  const legacyTweetJsonUrl = "data/czml/tweets.json";
  const arReturnLocationKey = "tweetMappingArReturnLocation";
  const arReturnLocationTtlMs = 10 * 60 * 1000;
  const arReturnViewHeightMeters = 2000.0;
  const trackingViewHeightMeters = 2000.0;
  const trackingMarkerHeightMeters = 20.0;
  const trackingGeoOptions = {
    enableHighAccuracy: false,
    maximumAge: 15000,
    timeout: 20000,
  };
  const trackingCameraUpdateIntervalMs = 5000;
  const trackingCameraUpdateMinDistanceMeters = 25;

  const tweetTextById = new Map();
  const renderedTweetById = new Map();
  const loadedTileKeys = new Set();
  const loadingTileKeys = new Set();
  const tileTweetIds = new Map();
  const tweetIconUrlByName = new Map();
  const tweetIconImageByName = new Map();
  const tweetIconLoadPromiseByName = new Map();
  const billboardPool = [];
  const labelPool = [];

  let tweetTileIndex = null;
  let isInitialTilesLoaded = false;
  let translucencyByDistance;
  let labelPixelOffset;
  let labelScaleByDistance;
  let labelVerticalOrigin;
  let labelSliceText;
  let tweetBillboards;
  let tweetLabels;
  let renderPumpFrame = null;
  let renderPumpUntil = 0;

  let visibleFilterIds = null;
  let cullingEnabled = false;
  let cullTimer = null;
  let tileLoadTimer = null;
  let locationTrackingEnabled = false;
  let locationWatchId = null;
  let lastTrackingCameraUpdateAt = 0;
  let lastTrackingCameraPosition = null;
  let currentVisibleTileKeys = new Set();
  const isSmartphone = detectSmartphoneContext();
  const isArReturnNavigation = detectArReturnNavigation();
  const arReturnLocation = consumeArReturnLocation();
  const cullMarginPx = 32;
  const tileLoadDebounceMs = 120;
  const tilePrefetchMargin = 1;
  const scratchToObject = new Cesium.Cartesian3();
  const scratchWindow = new Cesium.Cartesian2();
  const projectToWindowCoordinates =
    (typeof Cesium.SceneTransforms.wgs84ToWindowCoordinates === "function" &&
      Cesium.SceneTransforms.wgs84ToWindowCoordinates.bind(Cesium.SceneTransforms)) ||
    (typeof Cesium.SceneTransforms.worldToWindowCoordinates === "function" &&
      Cesium.SceneTransforms.worldToWindowCoordinates.bind(Cesium.SceneTransforms)) ||
    null;

  function getDevice() {
    const ua = navigator.userAgent;
    if (ua.indexOf("iPhone") > 0 || ua.indexOf("iPod") > 0 || (ua.indexOf("Android") > 0 && ua.indexOf("Mobile") > 0)) {
      return 1;
    }
    if (ua.indexOf("iPad") > 0 || ua.indexOf("Android") > 0) {
      return 2;
    }
    return 0;
  }

  function detectSmartphoneContext() {
    const ua = navigator.userAgent || "";
    const uaMobile = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|webOS|Opera Mini/i.test(ua);

    const shortEdge = Math.min(window.screen.width || 0, window.screen.height || 0);
    const longEdge = Math.max(window.screen.width || 0, window.screen.height || 0);
    const smartphoneScreen = shortEdge > 0 && shortEdge <= 480 && longEdge <= 932;

    const compactViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 480;
    const coarsePointer =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const touchDevice = (navigator.maxTouchPoints || 0) > 0;

    if (getDevice() === 1) {
      return true;
    }
    if (uaMobile) {
      return true;
    }
    if (touchDevice && coarsePointer && (smartphoneScreen || compactViewport)) {
      return true;
    }
    return false;
  }

  function resizeWindow() {
    $(cesiumContainerDiv).css("height", "100%");
    $(cesiumContainerDiv).css("width", "100%");
    $(blackOutDiv).css("height", "100%");
    $(blackOutDiv).css("width", "100%");
    setTimeout(loadCesium, 100);
  }

  (function screenAdjust() {
    if (!isSmartphone) {
      setTimeout(resizeWindow, 0);
      return;
    }
    $(".titleImage").css("width", "100%");
    setTimeout(resizeWindow, 1000);
  })();

  function applySmartphoneGoogle2DLayer() {
    if (!isSmartphone) {
      return;
    }

    const googleRoadMapUrl =
      "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" +
      (googleMapsApiKey ? "&key=" + encodeURIComponent(googleMapsApiKey) : "");

    viewer.imageryLayers.removeAll();
    baseImageryLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: googleRoadMapUrl,
        credit: "Google",
        maximumLevel: 20,
      })
    );
    baseImageryLayer.brightness = 0.9;
  }

  function loadCesium() {
    viewer = new Cesium.Viewer(cesiumContainerDiv, {
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      geocoder: false,
      timeline: false,
      animation: false,
      sceneModePicker: false,
      scene3DOnly: true,
      baseLayerPicker: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: true,
    });

    applySmartphoneGoogle2DLayer();
    if (!baseImageryLayer) {
      baseImageryLayer = viewer.imageryLayers.get(0);
    }
    if (baseImageryLayer) {
      baseImageryLayer.brightness = baseBrightnessDefault;
    }

    viewer.camera.frustum.fov = Cesium.Math.toRadians(80);

    const cesiumDiv = document.getElementById("cesiumContainer");
    function preventScroll(event) {
      event.preventDefault();
    }
    cesiumDiv.addEventListener("gesturestart", preventScroll, false);
    cesiumDiv.addEventListener("gesturechange", preventScroll, false);
    cesiumDiv.addEventListener("gestureend", preventScroll, false);

    if (!isSmartphone) {
      // Start photogrammetry loading as early as possible to reduce zoom-in lag.
      loadPhotogrammetry();
    }
    openingSequence(arReturnLocation);
  }

  function applyTweetDisplayTone() {
    tweetDisplayToneEnabled = true;
    if (baseImageryLayer) {
      baseImageryLayer.brightness = baseBrightnessTweetDisplay;
    }
    if (photogrammetryTileset) {
      photogrammetryTileset.style = new Cesium.Cesium3DTileStyle({
        color: "rgba(110, 110, 110, 1)",
      });
    }
    viewer.scene.requestRender();
  }

  function openingSequence(initialLocation) {
    fadeInOut(blackOutDiv, 0);
    fadeInOut(loadingDiv, 0);

    if (initialLocation || isArReturnNavigation) {
      $(".titleScreen").remove();
      if (initialLocation) {
        setViewToCoordinates(initialLocation.lon, initialLocation.lat);
      }
      fadeInOut(blackOutDiv, 1);
      fadeInOut(loadingDiv, 1);
      loadTweets();
      viewer.scene.globe.show = isSmartphone;
      startLocationTracking();
      return;
    }

    Promise.resolve()
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            $(".titleScreen").fadeOut(1000);
            setTimeout(function () {
              $(".titleScreen").remove();
            }, 1000);
            changeViewPoint(0, 3);
            resolve();
          }, 2000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            changeViewPoint(1, 3);
            resolve();
          }, 3000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            fadeInOut(blackOutDiv, 1);
            fadeInOut(loadingDiv, 1);
            resolve();
          }, 3000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            loadTweets();
            resolve();
          }, 1000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            viewer.scene.globe.show = isSmartphone;
            resolve();
          }, 500);
        });
      });
  }

  function consumeArReturnLocation() {
    const queryLocation = consumeArReturnLocationFromQuery();
    if (queryLocation) {
      return queryLocation;
    }
    if (!window.sessionStorage) {
      return null;
    }
    try {
      const raw = window.sessionStorage.getItem(arReturnLocationKey);
      if (!raw) {
        return null;
      }
      window.sessionStorage.removeItem(arReturnLocationKey);
      const parsed = JSON.parse(raw);
      const lat = Number(parsed && parsed.lat);
      const lon = Number(parsed && parsed.lon);
      const timestamp = Number(parsed && parsed.timestamp);
      const isFresh = Number.isFinite(timestamp) && Date.now() - timestamp <= arReturnLocationTtlMs;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isFresh) {
        return null;
      }
      return { lat: lat, lon: lon };
    } catch (error) {
      return null;
    }
  }

  function detectArReturnNavigation() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("ar_return") === "1";
    } catch (error) {
      return false;
    }
  }

  function consumeArReturnLocationFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const lat = Number(params.get("ar_return_lat"));
      const lon = Number(params.get("ar_return_lon"));
      const timestamp = Number(params.get("ar_return_ts"));
      const hasLat = Number.isFinite(lat);
      const hasLon = Number.isFinite(lon);
      if (!hasLat || !hasLon) {
        return null;
      }
      const hasTimestamp = Number.isFinite(timestamp);
      if (hasTimestamp && Date.now() - timestamp > arReturnLocationTtlMs) {
        return null;
      }
      if (window.history && typeof window.history.replaceState === "function") {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", cleanUrl);
      }
      return { lat: lat, lon: lon };
    } catch (error) {
      return null;
    }
  }

  function loadPhotogrammetry() {
    if (isSmartphone) {
      return Promise.resolve(null);
    }

    if (photogrammetryTilesetPromise) {
      return photogrammetryTilesetPromise;
    }

    const globe = viewer.scene.globe;
    globe.baseColor = Cesium.Color.fromCssColorString("#000000");

    photogrammetryTilesetPromise = (async function () {
      try {
        const tileset = viewer.scene.primitives.add(
          await Cesium.Cesium3DTileset.fromIonAssetId(tilesetIonAssetId, {
            // Keep early fetch, but reduce coarse LOD artifacts near ground.
            maximumScreenSpaceError: 24,
            skipLevelOfDetail: false,
            immediatelyLoadDesiredLevelOfDetail: true,
            preloadWhenHidden: true,
            cullWithChildrenBounds: true,
          })
        );
        photogrammetryTileset = tileset;
        tileset.dynamicScreenSpaceError = true;
        tileset.dynamicScreenSpaceErrorFactor = 1.5;
        tileset.dynamicScreenSpaceErrorDensity = 0.0012;
        if (tweetDisplayToneEnabled) {
          applyTweetDisplayTone();
        }
        viewer.scene.requestRender();
        return tileset;
      } catch (error) {
        console.log(error);
        return null;
      }
    })();

    return photogrammetryTilesetPromise;
  }

  function changeViewPoint(num, delay) {
    const viewPoint = viewPointsArray[num];
    const newHeading = Cesium.Math.toRadians(viewPoint.heading);
    const newPitch = Cesium.Math.toRadians(viewPoint.pitch);
    const center = Cesium.Cartesian3.fromDegrees(viewPoint.lng, viewPoint.lat);
    const boundingSphere = new Cesium.BoundingSphere(center, viewPoint.range);
    const headingPitchRange = new Cesium.HeadingPitchRange(newHeading, newPitch, viewPoint.range);

    viewer.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: delay,
      offset: headingPitchRange,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function scheduleVisibilityUpdate() {
    if (cullTimer !== null) {
      return;
    }
    cullTimer = setTimeout(function () {
      cullTimer = null;
      updateVisibleTweets();
    }, 50);
  }

  function updateVisibleTweets() {
    if (!tweetBillboards || !tweetLabels || !viewer) {
      return;
    }

    const canvas = viewer.scene.canvas;
    loadedTileKeys.forEach(function (tileKey) {
      const tweetIds = tileTweetIds.get(tileKey);
      const tileVisible = currentVisibleTileKeys.has(tileKey);
      if (!tweetIds || tweetIds.length === 0) {
        return;
      }

      for (let i = 0; i < tweetIds.length; i++) {
        const rendered = renderedTweetById.get(tweetIds[i]);
        if (!rendered) {
          continue;
        }
        const billboard = rendered.billboard;
        const label = rendered.label;

        if (!tileVisible) {
          billboard.show = false;
          label.show = false;
          continue;
        }

        if (visibleFilterIds && !visibleFilterIds.has(billboard.id)) {
          billboard.show = false;
          label.show = false;
          continue;
        }

        const toObject = Cesium.Cartesian3.subtract(billboard.position, viewer.camera.positionWC, scratchToObject);
        const isFront = Cesium.Cartesian3.dot(viewer.camera.directionWC, toObject) > 0;
        if (!isFront) {
          billboard.show = false;
          label.show = false;
          continue;
        }

        const windowPosition = projectToWindowCoordinates
          ? projectToWindowCoordinates(viewer.scene, billboard.position, scratchWindow)
          : null;
        const isOnScreen =
          !!windowPosition &&
          windowPosition.x >= -cullMarginPx &&
          windowPosition.x <= canvas.clientWidth + cullMarginPx &&
          windowPosition.y >= -cullMarginPx &&
          windowPosition.y <= canvas.clientHeight + cullMarginPx;

        billboard.show = isOnScreen;
        label.show = isOnScreen;
      }
    });

    viewer.scene.requestRender();
  }

  function setupVisibilityCulling() {
    if (cullingEnabled) {
      return;
    }
    cullingEnabled = true;
    viewer.camera.changed.addEventListener(scheduleVisibilityUpdate);
    window.addEventListener("resize", scheduleVisibilityUpdate);
    scheduleVisibilityUpdate();
  }

  function lonLatToTileXY(lon, lat, z) {
    const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const n = Math.pow(2, z);
    const x = Math.floor(((lon + 180.0) / 360.0) * n);
    const latRad = Cesium.Math.toRadians(latClamped);
    const y = Math.floor(((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * n);
    return {
      x: Math.max(0, Math.min(n - 1, x)),
      y: Math.max(0, Math.min(n - 1, y)),
    };
  }

  function buildVisibleTileKeySet(prefetchMargin) {
    const tileKeys = new Set();
    if (!tweetTileIndex) {
      return tileKeys;
    }

    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) {
      return tileKeys;
    }

    const zoom = tweetTileIndex.zoom;
    const westDeg = Cesium.Math.toDegrees(rectangle.west);
    const eastDeg = Cesium.Math.toDegrees(rectangle.east);
    const southDeg = Cesium.Math.toDegrees(rectangle.south);
    const northDeg = Cesium.Math.toDegrees(rectangle.north);
    const lonSegments = westDeg <= eastDeg ? [[westDeg, eastDeg]] : [[westDeg, 180.0], [-180.0, eastDeg]];

    for (let i = 0; i < lonSegments.length; i++) {
      const segment = lonSegments[i];
      const min = lonLatToTileXY(segment[0], northDeg, zoom);
      const max = lonLatToTileXY(segment[1], southDeg, zoom);
      const margin = typeof prefetchMargin === "number" ? prefetchMargin : tilePrefetchMargin;
      const minX = Math.min(min.x, max.x) - margin;
      const maxX = Math.max(min.x, max.x) + margin;
      const minY = Math.min(min.y, max.y) - margin;
      const maxY = Math.max(min.y, max.y) + margin;
      const tileCount = Math.pow(2, zoom);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (x < 0 || y < 0 || y >= tileCount || x >= tileCount) {
            continue;
          }
          const tileKey = zoom + "/" + x + "/" + y;
          if (tweetTileIndex.tiles[tileKey]) {
            tileKeys.add(tileKey);
          }
        }
      }
    }

    return tileKeys;
  }

  function requestSceneRender() {
    if (viewer && viewer.scene) {
      viewer.scene.requestRender();
    }
  }

  function requestSceneRenderFor(durationMs) {
    requestSceneRender();
    if (typeof window.requestAnimationFrame !== "function") {
      return;
    }
    renderPumpUntil = Math.max(renderPumpUntil, Date.now() + durationMs);
    if (renderPumpFrame !== null) {
      return;
    }

    const pump = function () {
      requestSceneRender();
      if (Date.now() < renderPumpUntil) {
        renderPumpFrame = window.requestAnimationFrame(pump);
      } else {
        renderPumpFrame = null;
      }
    };
    renderPumpFrame = window.requestAnimationFrame(pump);
  }

  function getTweetIconUrl(iconName) {
    const fileName = iconName || "twitter.png";
    let imageUrl = tweetIconUrlByName.get(fileName);
    if (imageUrl) {
      return imageUrl;
    }
    imageUrl = "data/icon/flags/" + fileName;
    tweetIconUrlByName.set(fileName, imageUrl);
    return imageUrl;
  }

  function loadTweetIcon(iconName) {
    const fileName = iconName || "twitter.png";
    const loadedImage = tweetIconImageByName.get(fileName);
    if (loadedImage) {
      return Promise.resolve(loadedImage);
    }
    const pending = tweetIconLoadPromiseByName.get(fileName);
    if (pending) {
      return pending;
    }

    const imageUrl = getTweetIconUrl(fileName);
    const promise = new Promise(function (resolve) {
      const img = new Image();
      let settled = false;
      const timeoutId = window.setTimeout(function () {
        finish(null);
      }, 3000);
      const finish = function (image) {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        if (image && image.naturalWidth > 0) {
          tweetIconImageByName.set(fileName, image);
          requestSceneRenderFor(900);
          resolve(image);
        } else {
          requestSceneRenderFor(900);
          resolve(null);
        }
      };
      const finishLoaded = function () {
        if (typeof img.decode === "function") {
          img.decode().then(
            function () {
              finish(img);
            },
            function () {
              finish(img);
            }
          );
        } else {
          finish(img);
        }
      };
      img.onload = finishLoaded;
      img.onerror = function () {
        finish(null);
      };
      img.src = imageUrl;
      if (img.complete) {
        finishLoaded();
      }
    });
    tweetIconLoadPromiseByName.set(fileName, promise);
    return promise;
  }

  function applyTweetBillboardImage(billboard, iconName) {
    const fileName = iconName || "twitter.png";
    const loadedImage = tweetIconImageByName.get(fileName);
    if (loadedImage && typeof billboard.setImage === "function") {
      billboard.setImage(fileName, loadedImage);
      return true;
    }
    if (loadedImage) {
      billboard.image = loadedImage;
      return true;
    }
    billboard.image = getTweetIconUrl(fileName);
    return false;
  }

  function acquireTweetPrimitive() {
    const pooledBillboard = billboardPool.pop();
    const pooledLabel = labelPool.pop();
    if (pooledBillboard && pooledLabel) {
      return {
        billboard: pooledBillboard,
        label: pooledLabel,
      };
    }
    return {
      billboard: tweetBillboards.add({ show: false }),
      label: tweetLabels.add({ show: false }),
    };
  }

  function releaseTweetPrimitive(rendered) {
    if (!rendered) {
      return;
    }
    rendered.billboard.show = false;
    rendered.billboard.id = undefined;
    rendered.label.show = false;
    rendered.label.id = undefined;
    billboardPool.push(rendered.billboard);
    labelPool.push(rendered.label);
  }

  function addTweetToScene(tweet, tileKey) {
    if (!tweet || renderedTweetById.has(tweet.id)) {
      return;
    }

    const name = tweet.text.length > labelSliceText ? tweet.text.slice(0, labelSliceText) + "..." : tweet.text;
    const height = 200 + 500 * Math.random();
    const position = Cesium.Cartesian3.fromDegrees(tweet.lon, tweet.lat, height);
    const rendered = acquireTweetPrimitive();
    const billboard = rendered.billboard;
    const label = rendered.label;
    const iconReady = applyTweetBillboardImage(billboard, tweet.img);

    billboard.id = tweet.id;
    billboard.position = position;
    billboard.scale = 0.25;
    billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
    billboard.translucencyByDistance = translucencyByDistance;
    billboard.show = true;

    label.id = tweet.id;
    label.position = position;
    label.font = "11pt Sans-Serif";
    label.style = Cesium.LabelStyle.FILL;
    label.fillColor = Cesium.Color.WHITE;
    label.pixelOffset = labelPixelOffset;
    label.text = name;
    label.scaleByDistance = labelScaleByDistance;
    label.verticalOrigin = labelVerticalOrigin;
    label.disableDepthTestDistance = Number.POSITIVE_INFINITY;
    label.translucencyByDistance = translucencyByDistance;
    label.show = true;

    renderedTweetById.set(tweet.id, {
      billboard: billboard,
      label: label,
      tileKey: tileKey,
    });

    if (!iconReady) {
      loadTweetIcon(tweet.img).then(function (image) {
        const current = renderedTweetById.get(tweet.id);
        if (!image || !current || current.billboard !== billboard) {
          return;
        }
        applyTweetBillboardImage(billboard, tweet.img);
        requestSceneRenderFor(900);
      });
    }
  }

  function removeTileFromScene(tileKey) {
    const tweetIds = tileTweetIds.get(tileKey);
    if (!tweetIds) {
      return;
    }

    for (let i = 0; i < tweetIds.length; i++) {
      const tweetId = tweetIds[i];
      const rendered = renderedTweetById.get(tweetId);
      if (!rendered) {
        continue;
      }
      releaseTweetPrimitive(rendered);
      renderedTweetById.delete(tweetId);
    }

    tileTweetIds.delete(tileKey);
    loadedTileKeys.delete(tileKey);
  }

  function loadTileByKey(tileKey) {
    if (!tweetTileIndex || loadedTileKeys.has(tileKey) || loadingTileKeys.has(tileKey)) {
      return Promise.resolve();
    }

    const tileMeta = tweetTileIndex.tiles[tileKey];
    if (!tileMeta) {
      return Promise.resolve();
    }

    loadingTileKeys.add(tileKey);
    return $.getJSON("data/czml/tweet-tiles/" + tileMeta.path)
      .then(function (tileData) {
        const tileTweets = (tileData && tileData.tweets) || [];
        const ids = [];
        for (let i = 0; i < tileTweets.length; i++) {
          const tweet = tileTweets[i];
          addTweetToScene(tweet, tileKey);
          ids.push(tweet.id);
          if (!tweetTextById.has(tweet.id)) {
            tweetTextById.set(tweet.id, tweet.text);
          }
        }
        tileTweetIds.set(tileKey, ids);
        loadedTileKeys.add(tileKey);
        loadingDiv.innerHTML =
          "<p>" +
          renderedTweetById.size +
          "/" +
          (tweetTileIndex.totalTweets || renderedTweetById.size) +
          " (visible tiles)</p>";
      })
      .always(function () {
        loadingTileKeys.delete(tileKey);
      });
  }

  function scheduleTileLoadByView() {
    if (tileLoadTimer !== null) {
      return;
    }
    tileLoadTimer = setTimeout(function () {
      tileLoadTimer = null;
      loadTilesByView();
    }, tileLoadDebounceMs);
  }

  function loadTilesByView() {
    if (!tweetTileIndex) {
      return;
    }

    currentVisibleTileKeys = buildVisibleTileKeySet(0);
    const targetTileKeys = buildVisibleTileKeySet(tilePrefetchMargin);
    const loadPromises = [];

    loadedTileKeys.forEach(function (loadedTileKey) {
      if (!targetTileKeys.has(loadedTileKey)) {
        removeTileFromScene(loadedTileKey);
      }
    });

    targetTileKeys.forEach(function (tileKey) {
      loadPromises.push(loadTileByKey(tileKey));
    });

    Promise.all(loadPromises).then(function () {
      if (!isInitialTilesLoaded) {
        isInitialTilesLoaded = true;
        finishLoading();
      }
      updateVisibleTweets();
      viewer.scene.requestRender();
    });
  }

  function loadSearchIndex() {
    return $.getJSON(tweetSearchIndexUrl).then(function (searchData) {
      const tweets = (searchData && searchData.tweets) || [];
      for (let i = 0; i < tweets.length; i++) {
        const item = tweets[i];
        tweetTextById.set(item.id, item.text);
      }
    });
  }

  function convertLegacyTweetsToTileIndex(legacyTweets) {
    const pseudoIndex = {
      zoom: 9,
      totalTweets: legacyTweets.length,
      tiles: {
        "9/0/0": { path: "__legacy__", count: legacyTweets.length },
      },
    };

    tweetTileIndex = pseudoIndex;
    const ids = [];
    for (let i = 0; i < legacyTweets.length; i++) {
      const src = legacyTweets[i];
      const coords = src.position && src.position.cartographicDegrees;
      if (!coords || coords.length < 2) {
        continue;
      }
      const tweet = {
        id: String(src.id),
        text: String(src.text || ""),
        lon: Number(coords[0]),
        lat: Number(coords[1]),
        img: src.billboard && src.billboard.image ? String(src.billboard.image) : "twitter.png",
      };
      if (!Number.isFinite(tweet.lon) || !Number.isFinite(tweet.lat)) {
        continue;
      }
      addTweetToScene(tweet, "9/0/0");
      tweetTextById.set(tweet.id, tweet.text);
      ids.push(tweet.id);
    }
    tileTweetIds.set("9/0/0", ids);
    loadedTileKeys.add("9/0/0");
    isInitialTilesLoaded = true;
    finishLoading();
    updateVisibleTweets();
    viewer.scene.requestRender();
  }

  function loadTweets() {
    const newBillboardCollection = new Cesium.BillboardCollection();
    const newLabelCollection = new Cesium.LabelCollection();
    tweetBillboards = viewer.scene.primitives.add(newBillboardCollection);
    tweetLabels = viewer.scene.primitives.add(newLabelCollection);
    translucencyByDistance = new Cesium.NearFarScalar(500.0, 1.0, 3000000, 0.0);
    labelPixelOffset = new Cesium.Cartesian2(20.0, 0);
    labelScaleByDistance = new Cesium.NearFarScalar(0.0, 1.4, 7500, 0.7);
    labelVerticalOrigin = Cesium.VerticalOrigin.CENTER;
    labelSliceText = isSmartphone ? 10 : 20;

    loadTweetIcon("twitter.png").then(function () {
      $.getJSON(tweetTileIndexUrl)
        .done(function (indexData) {
          tweetTileIndex = indexData;
          loadSearchIndex().always(function () {
            scheduleTileLoadByView();
            viewer.camera.changed.addEventListener(scheduleTileLoadByView);
            window.addEventListener("resize", scheduleTileLoadByView);
          });
        })
        .fail(function () {
          $.getJSON(legacyTweetJsonUrl).done(convertLegacyTweetsToTileIndex);
        });
    });
  }

  function finishLoading() {
    applyTweetDisplayTone();
    requestSceneRenderFor(1500);
    setTimeout(function () {
      fadeInOut(blackOutDiv, 0);
      fadeInOut(loadingDiv, 0);
      if (!arReturnLocation && !isArReturnNavigation) {
        changeViewPoint(2, 3);
      } else {
        viewer.scene.requestRender();
      }
    }, 1000);

    setupVisibilityCulling();
    descriptionBalloon();
    loadingDiv.innerHTML = "<p class='twCounter'>Completed.</p>";
  }

  function descriptionBalloon() {
    $(".functions,.general-button").click(function () {
      $(tweetMessageDiv).hide();
    });

    viewer.camera.changed.addEventListener(function () {
      $(tweetMessageDiv).fadeOut(100);
    });

    viewer.screenSpaceEventHandler.setInputAction(function onLeftClick(movement) {
      const cameraPosRadians = viewer.camera.positionCartographic;
      const cameraPosLongitude = Cesium.Math.toDegrees(cameraPosRadians.longitude);

      const pickedObject = viewer.scene.pick(movement.position);
      if (!pickedObject) {
        $(tweetMessageDiv).hide();
        return;
      }

      const primitivePosition = pickedObject.primitive && pickedObject.primitive.position;
      if (!primitivePosition) {
        $(tweetMessageDiv).hide();
        return;
      }

      const objectPosCartographic = Cesium.Cartographic.fromCartesian(primitivePosition);
      const objectPosLongitude = Cesium.Math.toDegrees(objectPosCartographic.longitude);
      const distanceLongitude = Math.abs(cameraPosLongitude - objectPosLongitude);
      if (distanceLongitude >= 90) {
        return;
      }

      const pickedObjectId = pickedObject.id.toString();
      const text = tweetTextById.get(pickedObjectId);
      if (!text) {
        return;
      }
      const windowWidth = $(window).width();
      $(tweetMessageDiv).fadeIn(200);
      adjustDivPosition();

      $(window).click(function (e) {
        $(window).off("click");
        const rightMargin = windowWidth - e.pageX;
        $(tweetMessageDiv).html(text);

        if (!isSmartphone) {
          if (rightMargin < 320) {
            $(tweetMessageDiv).offset({ top: e.pageY + 8, left: e.pageX - 312 });
          } else {
            $(tweetMessageDiv).offset({ top: e.pageY + 8, left: e.pageX + 8 });
          }
        } else {
          $(tweetMessageDiv).offset({
            top: e.pageY + 8,
            left: windowWidth * 0.5 - 160,
          });
        }
      });
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  }

  function adjustDivPosition() {
    setTimeout(function () {
      const windowHeight = $(window).height();
      const pos = $(tweetMessageDiv).offset().top;
      const height = $(tweetMessageDiv).height();
      if (windowHeight - (pos + height) < 0) {
        $(tweetMessageDiv).offset({
          top: windowHeight - height - 12,
        });
      }
    }, 200);
  }

  function geocode() {
    const geocoder = new google.maps.Geocoder();
    const input = document.getElementById("inputtext").value;

    geocoder.geocode({ address: input }, function (results, status) {
      if (status !== "OK") {
        alert("見つかりません");
        return;
      }

      const viewport = results[0].geometry.viewport;
      const southWest = viewport.getSouthWest();
      const northEast = viewport.getNorthEast();
      const rectangle = Cesium.Rectangle.fromDegrees(
        southWest.lng(),
        southWest.lat(),
        northEast.lng(),
        northEast.lat()
      );
      viewer.camera.flyTo({
        destination: rectangle,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    });
  }

  function flyToMyLocation() {
    if (locationTrackingEnabled) {
      stopLocationTracking();
      return;
    }
    startLocationTracking();
  }

  function flyToCoordinates(lon, lat) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, 3000.0),
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function setViewToCoordinates(lon, lat) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, arReturnViewHeightMeters),
    });
    viewer.scene.requestRender();
  }

  function setTrackingButtonState(active) {
    if (!geoButtonDiv) {
      return;
    }
    geoButtonDiv.classList.toggle("is-tracking", !!active);
  }

  function ensureUserLocationPoints() {
    if (userLocationPointCollection) {
      return;
    }
    userLocationPointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    userLocationGlowPoint = userLocationPointCollection.add({
      pixelSize: 30,
      color: Cesium.Color.fromCssColorString("#ff9b2f").withAlpha(0.35),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    });
    userLocationCorePoint = userLocationPointCollection.add({
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString("#ffd3a1").withAlpha(0.98),
      outlineColor: Cesium.Color.fromCssColorString("#ff7a00").withAlpha(0.95),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    });
  }

  function showUserLocationPoint(lon, lat) {
    ensureUserLocationPoints();
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, trackingMarkerHeightMeters);
    userLocationGlowPoint.position = pos;
    userLocationCorePoint.position = pos;
    userLocationGlowPoint.show = true;
    userLocationCorePoint.show = true;
    viewer.scene.requestRender();
  }

  function hideUserLocationPoint() {
    if (!userLocationPointCollection) {
      return;
    }
    userLocationGlowPoint.show = false;
    userLocationCorePoint.show = false;
    viewer.scene.requestRender();
  }

  function shouldUpdateTrackingCamera(positionCartesian, force) {
    if (force || !lastTrackingCameraPosition) {
      return true;
    }
    const elapsed = Date.now() - lastTrackingCameraUpdateAt;
    if (elapsed < trackingCameraUpdateIntervalMs) {
      return false;
    }
    const movedMeters = Cesium.Cartesian3.distance(lastTrackingCameraPosition, positionCartesian);
    return movedMeters >= trackingCameraUpdateMinDistanceMeters;
  }

  function updateTrackingCamera(lon, lat, force) {
    const positionCartesian = Cesium.Cartesian3.fromDegrees(lon, lat, trackingMarkerHeightMeters);
    if (!shouldUpdateTrackingCamera(positionCartesian, force)) {
      return;
    }
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, trackingViewHeightMeters),
    });
    lastTrackingCameraPosition = Cesium.Cartesian3.clone(positionCartesian, new Cesium.Cartesian3());
    lastTrackingCameraUpdateAt = Date.now();
    viewer.scene.requestRender();
  }

  function handleTrackedPosition(position) {
    if (!position || !position.coords) {
      return;
    }
    const lat = Number(position.coords.latitude);
    const lon = Number(position.coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    showUserLocationPoint(lon, lat);
    updateTrackingCamera(lon, lat, !lastTrackingCameraPosition);
  }

  function startLocationTracking() {
    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== "function") {
      alert("この端末では現在地追跡を利用できません。");
      return;
    }
    if (locationTrackingEnabled) {
      return;
    }

    locationTrackingEnabled = true;
    lastTrackingCameraPosition = null;
    lastTrackingCameraUpdateAt = 0;
    setTrackingButtonState(true);

    locationWatchId = navigator.geolocation.watchPosition(
      function (position) {
        handleTrackedPosition(position);
      },
      function (error) {
        alert("現在地の追跡に失敗しました: " + error.message);
        stopLocationTracking();
      },
      trackingGeoOptions
    );

    navigator.geolocation.getCurrentPosition(
      function (position) {
        handleTrackedPosition(position);
      },
      function () {
        // watchPositionで更新が届く可能性があるため、ここでは何もしない。
      },
      trackingGeoOptions
    );
  }

  function stopLocationTracking() {
    if (!locationTrackingEnabled) {
      return;
    }
    locationTrackingEnabled = false;
    setTrackingButtonState(false);
    if (locationWatchId !== null && navigator.geolocation && typeof navigator.geolocation.clearWatch === "function") {
      navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
    lastTrackingCameraPosition = null;
    lastTrackingCameraUpdateAt = 0;
    hideUserLocationPoint();
  }

  window.addEventListener("pagehide", function () {
    stopLocationTracking();
  });

  function textSearch() {
    $(tweetMessageDiv).hide();
    const searchQuery = String(document.getElementById("searchQuery").value).trim();
    const matchedIdSet = searchQuery === "" ? null : new Set();

    if (searchQuery !== "") {
      tweetTextById.forEach(function (text, id) {
        if (text.includes(searchQuery)) {
          matchedIdSet.add(id);
        }
      });
    }

    if (!tweetBillboards || !tweetLabels) {
      return;
    }

    renderedTweetById.forEach(function (rendered, tweetId) {
      const billboard = rendered.billboard;
      const label = rendered.label;

      const matched = !matchedIdSet || matchedIdSet.has(tweetId);
      if (matched) {
        if (searchQuery === "") {
          billboard.translucencyByDistance = translucencyByDistance;
          label.translucencyByDistance = translucencyByDistance;
        } else {
          billboard.translucencyByDistance = undefined;
          label.translucencyByDistance = undefined;
        }
      } else {
        billboard.translucencyByDistance = translucencyByDistance;
        label.translucencyByDistance = translucencyByDistance;
      }
    });

    visibleFilterIds = matchedIdSet;
    updateVisibleTweets();
  }

  function fadeInOut(layer, param) {
    if (param === 0) {
      $(layer).fadeOut("slow");
      viewer.trackedEntity = undefined;
      return;
    }
    $(layer).fadeIn("slow");
  }

  function about() {
    window.open("https://github.com/wtnv-lab/tweetMapping");
  }

  window.geocode = geocode;
  window.flyToMyLocation = flyToMyLocation;
  window.textSearch = textSearch;
  window.about = about;
})();
