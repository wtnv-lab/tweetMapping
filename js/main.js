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

  let viewer;
  let photogrammetryTilesetPromise = null;
  let photogrammetryTileset = null;
  let tweetDisplayToneEnabled = false;
  let baseImageryLayer = null;

  const baseBrightnessDefault = 1.0;
  const baseBrightnessTweetDisplay = 0.5;

  const tweetTileIndexUrl = "data/czml/tweet-tiles/index.json";
  const tweetSearchIndexUrl = "data/czml/tweet-tiles/search.json";
  const legacyTweetJsonUrl = "data/czml/tweets.json";

  const tweetTextById = new Map();
  const renderedTweetById = new Map();
  const loadedTileKeys = new Set();
  const loadingTileKeys = new Set();
  const tileTweetIds = new Map();

  let tweetTileIndex = null;
  let isInitialTilesLoaded = false;
  let translucencyByDistance;
  let labelPixelOffset;
  let labelScaleByDistance;
  let labelVerticalOrigin;
  let labelSliceText;
  let tweetBillboards;
  let tweetLabels;

  let visibleFilterIds = null;
  let cullingEnabled = false;
  let cullTimer = null;
  let tileLoadTimer = null;
  const isSmartphone = getDevice() === 1;
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
    openingSequence();
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

  function openingSequence() {
    fadeInOut(blackOutDiv, 0);
    fadeInOut(loadingDiv, 0);

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
    for (let i = 0; i < tweetBillboards.length; i++) {
      const billboard = tweetBillboards.get(i);
      const label = tweetLabels.get(i);

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

  function buildVisibleTileKeySet() {
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
      const minX = Math.min(min.x, max.x) - tilePrefetchMargin;
      const maxX = Math.max(min.x, max.x) + tilePrefetchMargin;
      const minY = Math.min(min.y, max.y) - tilePrefetchMargin;
      const maxY = Math.max(min.y, max.y) + tilePrefetchMargin;
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

  function addTweetToScene(tweet, tileKey) {
    if (!tweet || renderedTweetById.has(tweet.id)) {
      return;
    }

    const name = tweet.text.length > labelSliceText ? tweet.text.slice(0, labelSliceText) + "..." : tweet.text;
    const height = 200 + 500 * Math.random();
    const position = Cesium.Cartesian3.fromDegrees(tweet.lon, tweet.lat, height);

    const billboard = tweetBillboards.add({
      id: tweet.id,
      position: position,
      image: "data/icon/flags/" + tweet.img,
      scale: 0.25,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: translucencyByDistance,
    });

    const label = tweetLabels.add({
      id: tweet.id,
      position: position,
      font: "11pt Sans-Serif",
      style: Cesium.LabelStyle.FILL,
      fillColor: Cesium.Color.WHITE,
      pixelOffset: labelPixelOffset,
      text: name,
      scaleByDistance: labelScaleByDistance,
      verticalOrigin: labelVerticalOrigin,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: translucencyByDistance,
    });

    renderedTweetById.set(tweet.id, {
      billboard: billboard,
      label: label,
    });
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
      tweetBillboards.remove(rendered.billboard);
      tweetLabels.remove(rendered.label);
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

    const targetTileKeys = buildVisibleTileKeySet();
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
  }

  function finishLoading() {
    applyTweetDisplayTone();
    setTimeout(function () {
      fadeInOut(blackOutDiv, 0);
      fadeInOut(loadingDiv, 0);
      changeViewPoint(2, 3);
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
    function fly(position) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 3000.0),
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }

    navigator.geolocation.getCurrentPosition(fly);
  }

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

    for (let i = 0; i < tweetBillboards.length; i++) {
      const billboard = tweetBillboards.get(i);
      const label = tweetLabels.get(i);

      const matched = !matchedIdSet || matchedIdSet.has(billboard.id);
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
    }

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
