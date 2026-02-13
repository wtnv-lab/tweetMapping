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
    googleMapsScript.src = "https://maps.googleapis.com/maps/api/js?key=" + googleMapsApiKey + "&callback=initMap";
    googleMapsScript.async = true;
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

  // 検索用配列
  const jsonArray = [];
  let translucencyByDistance;
  let tweetBillboards;
  let tweetLabels;
  let loadTimer;

  let visibleFilterIds = null;
  let cullingEnabled = false;
  let cullTimer = null;
  const cullMarginPx = 32;
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
    if (getDevice() !== 1) {
      setTimeout(resizeWindow, 0);
      return;
    }
    $(".titleImage").css("width", "100%");
    setTimeout(resizeWindow, 1000);
  })();

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

    const baseLayer = viewer.imageryLayers.get(0);
    if (baseLayer) {
      baseLayer.brightness = 0.5;
    }

    viewer.camera.frustum.fov = Cesium.Math.toRadians(80);

    const cesiumDiv = document.getElementById("cesiumContainer");
    function preventScroll(event) {
      event.preventDefault();
    }
    cesiumDiv.addEventListener("gesturestart", preventScroll, false);
    cesiumDiv.addEventListener("gesturechange", preventScroll, false);
    cesiumDiv.addEventListener("gestureend", preventScroll, false);

    openingSequence();
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
            loadPhotogrammetry();
            resolve();
          }, 1000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            viewer.scene.globe.show = false;
            resolve();
          }, 500);
        });
      });
  }

  function loadPhotogrammetry() {
    const globe = viewer.scene.globe;
    globe.baseColor = Cesium.Color.fromCssColorString("#000000");

    (async function () {
      try {
        const tileset = viewer.scene.primitives.add(await Cesium.Cesium3DTileset.fromIonAssetId(tilesetIonAssetId));
        tileset.style = new Cesium.Cesium3DTileStyle({
          color: "rgba(110, 110, 110, 1)",
        });
        tileset.dynamicScreenSpaceError = true;
        tileset.dynamicScreenSpaceErrorFactor = 12;
      } catch (error) {
        console.log(error);
      }
    })();
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

  function loadTweets() {
    const billboardCollection = new Cesium.BillboardCollection();
    const labelCollection = new Cesium.LabelCollection();
    tweetBillboards = viewer.scene.primitives.add(billboardCollection);
    tweetLabels = viewer.scene.primitives.add(labelCollection);

    const pixelOffset = new Cesium.Cartesian2(20.0, 0);
    const scaleByDistance = new Cesium.NearFarScalar(0.0, 1.4, 7500, 0.7);
    translucencyByDistance = new Cesium.NearFarScalar(500.0, 1.0, 3000000, 0.0);
    const verticalOrigin = Cesium.VerticalOrigin.CENTER;
    const sliceText = getDevice() === 1 ? 10 : 20;
    let lastCounterUpdate = 0;

    let jsonNum = 0;

    $.getJSON("data/czml/tweets.json", function (json) {
      loadTimer = setInterval(function () {
        for (let i = 0; i < 50; i++) {
          if (jsonNum >= json.length) {
            clearInterval(loadTimer);
            loadTimer = undefined;
            finishLoading();
            break;
          }

          const tweet = json[jsonNum];
          const name = tweet.text.length > sliceText ? tweet.text.slice(0, sliceText) + "..." : tweet.text;
          const positions = tweet.position.cartographicDegrees;
          positions[2] = 200 + 500 * Math.random();
          const position = Cesium.Cartesian3.fromDegreesArrayHeights(positions)[0];

          tweetBillboards.add({
            id: tweet.id,
            position: position,
            image: "data/icon/flags/" + tweet.billboard.image,
            scale: 0.25,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            translucencyByDistance: translucencyByDistance,
          });

          tweetLabels.add({
            id: tweet.id,
            position: position,
            font: "11pt Sans-Serif",
            style: Cesium.LabelStyle.FILL,
            fillColor: Cesium.Color.WHITE,
            pixelOffset: pixelOffset,
            text: name,
            scaleByDistance: scaleByDistance,
            verticalOrigin: verticalOrigin,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            translucencyByDistance: translucencyByDistance,
          });

          jsonArray.push({
            id: tweet.id,
            text: tweet.text,
          });

          jsonNum++;
          const now = Date.now();
          if (now - lastCounterUpdate >= 100 || jsonNum === json.length) {
            lastCounterUpdate = now;
            loadingDiv.innerHTML = "<p>" + jsonNum + "/" + json.length + "</p>";
          }
        }
        viewer.scene.requestRender();
      }, 10);
    });
  }

  function finishLoading() {
    setTimeout(function () {
      fadeInOut(blackOutDiv, 0);
      fadeInOut(loadingDiv, 0);
      changeViewPoint(2, 3);
    }, 1000);

    if (loadTimer) {
      clearInterval(loadTimer);
      loadTimer = undefined;
    }

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
      const targetObject = jsonArray.find(function (entry) {
        return entry.id === pickedObjectId;
      });
      if (!targetObject) {
        return;
      }

      const text = targetObject.text;
      const windowWidth = $(window).width();
      $(tweetMessageDiv).fadeIn(200);
      adjustDivPosition();

      $(window).click(function (e) {
        $(window).off("click");
        const rightMargin = windowWidth - e.pageX;
        $(tweetMessageDiv).html(text);

        if (getDevice() !== 1) {
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
    const searchQuery = String(document.getElementById("searchQuery").value);
    const matchedIdSet =
      searchQuery === ""
        ? null
        : new Set(
            jsonArray
              .filter(function (obj) {
                return obj.text.includes(searchQuery);
              })
              .map(function (obj) {
                return obj.id;
              })
          );

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
