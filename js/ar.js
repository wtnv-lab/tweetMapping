(function () {
  const statusText = document.getElementById("statusText");
  const centerPanel = document.getElementById("centerPanel");
  const launchStatus = document.getElementById("launchStatus");
  const startButton = document.getElementById("startButton");
  const tweetCard = document.getElementById("tweetCard");
  const tweetBody = document.getElementById("tweetBody");
  const tweetMeta = document.getElementById("tweetMeta");
  const arRoot = document.getElementById("arRoot");
  const cameraFeed = document.getElementById("cameraFeed");
  const markerLayer = document.getElementById("markerLayer");

  const tweetDataUrl = "data/czml/tweets.json";
  const twitterIconUrl = "data/icon/flags/twitter.png";
  const locationPollIntervalMs = 5000;
  const permissionCacheKey = "tweetMappingArPermissionGrantedAt";
  const permissionCacheWindowMs = 30 * 24 * 60 * 60 * 1000;
  const displaySettings = window.AR_DISPLAY_SETTINGS || {};
  function numberSetting(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  const maxMarkers = numberSetting(displaySettings.maxMarkers, 100);
  const rebuildThresholdMeters = numberSetting(displaySettings.rebuildThresholdMeters, 30);
  const minBuildIntervalMs = numberSetting(displaySettings.minBuildIntervalMs, 1200);
  const maxLabelChars = numberSetting(displaySettings.maxLabelChars, 26);
  const arFieldYOffsetPx = numberSetting(displaySettings.arFieldYOffsetPx, -20);
  const offscreenMargin = numberSetting(displaySettings.offscreenMargin, 48);
  const laneStepDeg = numberSetting(displaySettings.laneStepDeg, 2.8);
  const clusterStepDeg = numberSetting(displaySettings.clusterStepDeg, 8.0);
  const ua = navigator.userAgent || "";
  const isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|webOS|Opera Mini/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const isMobileOrTablet = isPhone || isTablet || (touch && coarse);

  let allTweets = [];
  let currentPosition = null;
  let lastBuildPosition = null;
  let markerEntities = [];
  let dataLoaded = false;
  let scene = null;
  let cameraStream = null;
  let locationPollTimer = null;
  let deviceHeading = null;
  let renderedMarkerCount = 0;
  let nearbyCandidateCount = 0;
  let nearestDistanceMeters = null;
  let selectedMarker = null;
  let lastBuildAt = 0;
  let buildTimer = null;
  let markerRenderFrame = null;
  let arStarting = false;
  const projectedPoint = new THREE.Vector3();
  const cameraSpacePoint = new THREE.Vector3();

  function readPermissionGrantedAt() {
    try {
      const raw = window.localStorage ? window.localStorage.getItem(permissionCacheKey) : null;
      const ts = Number(raw);
      return Number.isFinite(ts) ? ts : 0;
    } catch (error) {
      return 0;
    }
  }

  function markPermissionGrantedNow() {
    try {
      if (!window.localStorage) {
        return;
      }
      window.localStorage.setItem(permissionCacheKey, String(Date.now()));
    } catch (error) {
      // Ignore storage errors (private mode or restricted context).
    }
  }

  function isPermissionCacheFresh() {
    const grantedAt = readPermissionGrantedAt();
    if (!grantedAt) {
      return false;
    }
    return Date.now() - grantedAt <= permissionCacheWindowMs;
  }

  function queryPermissionState(name) {
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
      return Promise.resolve("unknown");
    }
    try {
      return navigator.permissions
        .query({ name: name })
        .then(function (result) {
          return result && result.state ? result.state : "unknown";
        })
        .catch(function () {
          return "unknown";
        });
    } catch (error) {
      return Promise.resolve("unknown");
    }
  }

  function getPermissionSnapshot() {
    return Promise.all([
      queryPermissionState("geolocation"),
      queryPermissionState("camera"),
    ]).then(function (states) {
      return {
        geolocation: states[0],
        camera: states[1],
      };
    });
  }

  function shouldAutoStartFromPermissions(snapshot) {
    const geoState = snapshot && snapshot.geolocation ? snapshot.geolocation : "unknown";
    const camState = snapshot && snapshot.camera ? snapshot.camera : "unknown";
    const hasDenied = geoState === "denied" || camState === "denied";
    if (hasDenied) {
      return false;
    }
    const bothGranted = geoState === "granted" && camState === "granted";
    return bothGranted || isPermissionCacheFresh();
  }

  function scheduleBuild(forceNow) {
    if (forceNow) {
      if (buildTimer !== null) {
        clearTimeout(buildTimer);
        buildTimer = null;
      }
      buildMarkers();
      return;
    }
    const wait = Math.max(0, minBuildIntervalMs - (Date.now() - lastBuildAt));
    if (wait === 0) {
      buildMarkers();
      return;
    }
    if (buildTimer !== null) {
      return;
    }
    buildTimer = setTimeout(function () {
      buildTimer = null;
      buildMarkers();
    }, wait);
  }

  function setStatus(message) {
    if (!currentPosition || !currentPosition.coords) {
      statusText.textContent = message;
      return;
    }
    const lat = Number(currentPosition.coords.latitude);
    const lon = Number(currentPosition.coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      statusText.textContent = message;
      return;
    }
    statusText.textContent = message + "\n現在地: " + lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  function setLaunchStatus(message) {
    launchStatus.textContent = message;
  }

  function hideLaunchPanel() {
    centerPanel.classList.add("hidden");
  }

  function bindSceneEvents(targetScene) {
    targetScene.addEventListener("loaded", function () {
      if (!currentPosition) {
        setStatus("ARシーン起動完了。位置情報を待っています...");
      }
    });
    const onBackgroundTap = function (event) {
      if (!isTweetHitTarget(event.target)) {
        clearSelection();
      }
    };
    targetScene.addEventListener("click", onBackgroundTap);
    targetScene.addEventListener("touchstart", onBackgroundTap, { passive: true });
  }

  function createScene() {
    arRoot.innerHTML =
      '<a-scene id="arScene" embedded vr-mode-ui="enabled: false" renderer="antialias: true; alpha: true; logarithmicDepthBuffer: true;">' +
      '<a-assets timeout="10000"><img id="twitterIconAsset" src="' +
      twitterIconUrl +
      '" crossorigin="anonymous"></a-assets>' +
      '<a-entity id="arCamera" camera="fov: 108; near: 0.05; far: 12000" look-controls="enabled: true; magicWindowTrackingEnabled: true; touchEnabled: true" wasd-controls="enabled: false" cursor="rayOrigin: mouse" raycaster="objects: .tweet-hit; far: 12000" position="0 1.6 0"></a-entity>' +
      "</a-scene>";
    scene = document.getElementById("arScene");
    bindSceneEvents(scene);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180.0;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  function bearingDegrees(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180.0;
    const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
    const x =
      Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
      Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clearMarkers() {
    clearSelection();
    if (buildTimer !== null) {
      clearTimeout(buildTimer);
      buildTimer = null;
    }
    for (let i = 0; i < markerEntities.length; i++) {
      const marker = markerEntities[i].root;
      if (marker && marker.parentNode) {
        marker.parentNode.removeChild(marker);
      }
    }
    markerEntities = [];
  }

  function toLabel(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLabelChars) {
      return normalized;
    }
    return normalized.slice(0, maxLabelChars - 3) + "...";
  }

  function setMarkerSelected(marker, selected) {
    if (!marker) {
      return;
    }
    const root = marker.root;
    const iconBaseOpacity = marker.iconBaseOpacity;
    const labelBaseOpacity = marker.labelBaseOpacity;
    marker.icon.style.opacity = String(selected ? 1.0 : iconBaseOpacity);
    marker.label.style.opacity = String(selected ? 1.0 : labelBaseOpacity);
    if (selected) {
      root.classList.add("selected");
    } else {
      root.classList.remove("selected");
    }
  }

  function clearSelection() {
    if (selectedMarker) {
      setMarkerSelected(selectedMarker, false);
      selectedMarker = null;
    }
    tweetCard.classList.remove("visible");
  }

  function isTweetHitTarget(target) {
    return !!(target && target.closest && target.closest(".screen-marker"));
  }

  function selectMarker(marker) {
    if (!marker) {
      return;
    }
    if (selectedMarker && selectedMarker !== marker) {
      setMarkerSelected(selectedMarker, false);
    }
    selectedMarker = marker;
    setMarkerSelected(marker, true);
    const body = marker.tweetText || "";
    const dist = marker.distanceMeters || "-";
    tweetBody.textContent = body;
    tweetMeta.textContent = "ここから " + dist + "m";
    positionTweetCard(marker);
    tweetCard.classList.add("visible");
  }

  function positionTweetCard(marker) {
    if (!marker || !marker.root) {
      return;
    }
    const rect = marker.root.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const cardW = Math.min(viewportW * 0.88, 420);
    const cardH = 96;
    const margin = 12;
    let x = rect.left + rect.width * 0.5;
    x = clamp(x, cardW * 0.5 + margin, viewportW - cardW * 0.5 - margin);
    let y = rect.top - margin;
    if (y - cardH < margin) {
      y = rect.bottom + margin + cardH;
    }
    y = clamp(y, cardH + margin, viewportH - margin);
    tweetCard.style.left = x.toFixed(1) + "px";
    tweetCard.style.top = y.toFixed(1) + "px";
  }

  function projectToScreen(worldPosition, cameraObj, width, height) {
    cameraSpacePoint.copy(worldPosition).applyMatrix4(cameraObj.matrixWorldInverse);
    if (cameraSpacePoint.z >= -0.01) {
      return null;
    }
    projectedPoint.copy(worldPosition).project(cameraObj);
    if (projectedPoint.z < -1 || projectedPoint.z > 1) {
      return null;
    }
    const x = (projectedPoint.x * 0.5 + 0.5) * width;
    const y = (-projectedPoint.y * 0.5 + 0.5) * height;
    // Y is clamped later by UI layout logic; avoid hiding markers on strong tilt.
    if (x < -220 || x > width + 220) {
      return null;
    }
    return { x: x, y: y };
  }

  function updateScreenMarkers() {
    if (!scene || markerEntities.length === 0) {
      return;
    }
    const camEntity = scene.querySelector("#arCamera");
    if (!camEntity) {
      return;
    }
    const cameraObj = camEntity.getObject3D("camera");
    if (!cameraObj) {
      return;
    }
    cameraObj.updateMatrixWorld(true);
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < markerEntities.length; i++) {
      const marker = markerEntities[i];
      const screenPos = projectToScreen(marker.worldPosition, cameraObj, width, height);
      if (!screenPos) {
        marker.root.style.display = "none";
        continue;
      }
      const xScatter =
        (marker.laneOffset * numberSetting(displaySettings.xScatterLaneWeight, 34) +
          marker.clusterOffset * numberSetting(displaySettings.xScatterClusterWeight, 56)) *
        (numberSetting(displaySettings.xScatterBaseFactor, 0.8) +
          marker.distanceNorm * numberSetting(displaySettings.xScatterDistanceFactor, 1.2));
      const rawYScatter =
        (marker.laneOffset * numberSetting(displaySettings.yScatterLaneWeight, 17.5) +
          marker.clusterOffset * numberSetting(displaySettings.yScatterClusterWeight, 30)) *
        (numberSetting(displaySettings.yScatterBaseFactor, 0.4375) +
          marker.distanceNorm * numberSetting(displaySettings.yScatterDistanceFactor, 0.6875));
      const yScatterMagnitude = Math.abs(rawYScatter);
      const yScatter =
        marker.distanceNorm <= 0.5
          ? -yScatterMagnitude * numberSetting(displaySettings.yScatterUpMultiplier, 2.76)
          : yScatterMagnitude * numberSetting(displaySettings.yScatterDownMultiplier, 0.82);
      const distanceYOffset =
        (marker.distanceNorm - 0.5) * height * numberSetting(displaySettings.distanceYOffsetFactor, 0.56);
      const targetX = screenPos.x * 0.96 + (width * 0.5) * 0.04 + xScatter;
      const tiltPivotY = height * numberSetting(displaySettings.tiltPivotRatio, 0.35);
      const tiltReducedY =
        tiltPivotY + (screenPos.y - tiltPivotY) * numberSetting(displaySettings.tiltReduceFactor, 0.52);
      const limitedTiltY = clamp(
        tiltReducedY,
        tiltPivotY - height * numberSetting(displaySettings.tiltClampUpRatio, 0.14),
        tiltPivotY + height * numberSetting(displaySettings.tiltClampDownRatio, 0.14)
      );
      const targetY = clamp(
        limitedTiltY + distanceYOffset + yScatter + arFieldYOffsetPx,
        height * numberSetting(displaySettings.targetYMinRatio, -0.12),
        height * numberSetting(displaySettings.targetYMaxRatio, 0.7)
      );
      if (typeof marker.screenX !== "number" || typeof marker.screenY !== "number") {
        marker.screenX = targetX;
        marker.screenY = targetY;
      } else {
        // Keep Y smoothing for stability but make X more responsive to panning.
        marker.screenX += (targetX - marker.screenX) * numberSetting(displaySettings.screenXSmooth, 0.42);
        marker.screenY += (targetY - marker.screenY) * numberSetting(displaySettings.screenYSmooth, 0.22);
      }
      if (
        marker.screenX < -offscreenMargin ||
        marker.screenX > width + offscreenMargin ||
        marker.screenY < -offscreenMargin ||
        marker.screenY > height + offscreenMargin
      ) {
        marker.root.style.display = "none";
        continue;
      }
      marker.root.style.display = "inline-flex";
      marker.root.style.left = marker.screenX.toFixed(1) + "px";
      marker.root.style.top = marker.screenY.toFixed(1) + "px";
      marker.root.style.zIndex = String(10000 - Math.round(marker.distanceNorm * 8000));
    }
    if (selectedMarker && selectedMarker.root) {
      if (selectedMarker.root.style.display === "none") {
        clearSelection();
      } else {
        positionTweetCard(selectedMarker);
      }
    }
  }

  function startMarkerRenderLoop() {
    if (markerRenderFrame !== null) {
      return;
    }
    const tick = function () {
      markerRenderFrame = requestAnimationFrame(tick);
      updateScreenMarkers();
    };
    markerRenderFrame = requestAnimationFrame(tick);
  }

  function buildMarkers() {
    if (!scene || !currentPosition || !dataLoaded) {
      return;
    }
    lastBuildAt = Date.now();

    const lat = currentPosition.coords.latitude;
    const lon = currentPosition.coords.longitude;
    const candidates = [];
    let farthestSelectedDistance = 0;

    for (let i = 0; i < allTweets.length; i++) {
      const t = allTweets[i];
      const distance = haversineMeters(lat, lon, t.lat, t.lon);
      const entry = {
        tweet: t,
        distance: distance,
      };
      if (candidates.length < maxMarkers) {
        candidates.push(entry);
        if (distance > farthestSelectedDistance) {
          farthestSelectedDistance = distance;
        }
      } else if (distance < farthestSelectedDistance) {
        let farthestIndex = 0;
        let farthestDistance = candidates[0].distance;
        for (let j = 1; j < candidates.length; j++) {
          if (candidates[j].distance > farthestDistance) {
            farthestDistance = candidates[j].distance;
            farthestIndex = j;
          }
        }
        candidates[farthestIndex] = entry;
        farthestSelectedDistance = candidates[0].distance;
        for (let j = 1; j < candidates.length; j++) {
          if (candidates[j].distance > farthestSelectedDistance) {
            farthestSelectedDistance = candidates[j].distance;
          }
        }
      }
    }

    candidates.sort(function (a, b) {
      return a.distance - b.distance;
    });

    clearMarkers();

    const count = candidates.length;
    const nearestDistance = count > 0 ? Math.round(candidates[0].distance) : null;
    const farthestDistance = count > 0 ? candidates[count - 1].distance : null;
    const distanceSpan = farthestDistance !== null && nearestDistance !== null ? Math.max(1, farthestDistance - nearestDistance) : 1;
    const selectedRangeMeters = Math.max(1, farthestDistance !== null ? farthestDistance : 1);
    const headingNow = deviceHeading === null ? 0 : deviceHeading;
    const laneSlots = new Map();
    const clusterSlots = new Map();
    function directedOffsetUnits(indexInGroup, ratio) {
      if (indexInGroup === 0) {
        return 0;
      }
      // Near tweets: spread upward only. Far tweets: spread downward only.
      if (ratio <= 0.45) {
        return indexInGroup;
      }
      if (ratio >= 0.7) {
        return -indexInGroup;
      }
      const level = Math.floor((indexInGroup + 1) / 2);
      const sign = indexInGroup % 2 === 1 ? 1 : -1;
      return level * sign;
    }
    nearbyCandidateCount = allTweets.length;
    renderedMarkerCount = count;
    nearestDistanceMeters = nearestDistance;
    for (let i = 0; i < count; i++) {
      const candidate = candidates[i];
      const t = candidate.tweet;
      const distance = candidate.distance;
      const bearing = bearingDegrees(lat, lon, t.lat, t.lon);
      const relativeDeg = ((bearing - headingNow + 540) % 360) - 180;
      const relativeRad = (relativeDeg * Math.PI) / 180;
      const projected = distance;
      const x = Math.sin(relativeRad) * projected;
      const z = -Math.cos(relativeRad) * projected;
      const ratio = clamp(distance / selectedRangeMeters, 0, 1);
      const distanceNorm = clamp((distance - (nearestDistance !== null ? nearestDistance : distance)) / distanceSpan, 0, 1);
      const laneKey = String(Math.round(relativeDeg / laneStepDeg));
      const laneIndex = laneSlots.get(laneKey) || 0;
      laneSlots.set(laneKey, laneIndex + 1);
      const clusterKey = String(Math.round(relativeDeg / clusterStepDeg));
      const clusterIndex = clusterSlots.get(clusterKey) || 0;
      clusterSlots.set(clusterKey, clusterIndex + 1);
      // Keep vertical offsets small; distance is represented by true depth.
      const baseY = numberSetting(displaySettings.markerBaseY, 1.8);
      const spreadStep = numberSetting(displaySettings.markerSpreadStep, 0.45);
      const laneOffset = directedOffsetUnits(laneIndex, ratio);
      const clusterOffset = directedOffsetUnits(clusterIndex, ratio);
      const densityBoost =
        1 +
        Math.min(
          numberSetting(displaySettings.markerDensityMaxAdd, 2.0),
          clusterIndex * numberSetting(displaySettings.markerDensityClusterFactor, 0.2) +
            laneIndex * numberSetting(displaySettings.markerDensityLaneFactor, 0.1)
        );
      const combinedOffset =
        laneOffset + clusterOffset * numberSetting(displaySettings.markerClusterOffsetWeight, 1.8);
      const markerY = clamp(
        baseY + combinedOffset * spreadStep * densityBoost,
        numberSetting(displaySettings.markerYMin, 0.6),
        numberSetting(displaySettings.markerYMax, 7.5)
      );
      const iconSize = clamp(
        numberSetting(displaySettings.iconSizeMax, 86) -
          distanceNorm * numberSetting(displaySettings.iconSizeDistanceFactor, 74),
        numberSetting(displaySettings.iconSizeMin, 12),
        numberSetting(displaySettings.iconSizeMax, 86)
      );
      const label = toLabel(t.text);
      const labelFontNorm = Math.pow(
        distanceNorm,
        numberSetting(displaySettings.labelFontCurveExponent, 1.35)
      );
      const labelFontPx = Math.round(
        clamp(
          numberSetting(displaySettings.labelFontMax, 44) -
            labelFontNorm * numberSetting(displaySettings.labelFontDistanceFactor, 34),
          numberSetting(displaySettings.labelFontMin, 10),
          numberSetting(displaySettings.labelFontMax, 44)
        )
      );
      const iconOpacity = clamp(
        numberSetting(displaySettings.iconOpacityStart, 0.98) -
          distanceNorm * numberSetting(displaySettings.iconOpacityDistanceFactor, 0.62),
        numberSetting(displaySettings.iconOpacityMin, 0.36),
        numberSetting(displaySettings.iconOpacityMax, 0.98)
      );
      const labelOpacity = clamp(
        numberSetting(displaySettings.labelOpacityStart, 0.99) -
          distanceNorm * numberSetting(displaySettings.labelOpacityDistanceFactor, 0.68),
        numberSetting(displaySettings.labelOpacityMin, 0.31),
        numberSetting(displaySettings.labelOpacityMax, 0.99)
      );
      const worldPosition = new THREE.Vector3(x, markerY, z);

      const root = document.createElement("div");
      root.className = "screen-marker tweet-hit";
      root.style.fontSize = labelFontPx.toFixed(1) + "px";

      const icon = document.createElement("img");
      icon.className = "screen-marker-icon tweet-hit";
      icon.src = twitterIconUrl;
      icon.alt = "";
      icon.style.width = iconSize.toFixed(1) + "px";
      icon.style.height = iconSize.toFixed(1) + "px";
      icon.style.opacity = iconOpacity.toFixed(2);
      root.appendChild(icon);

      const labelSpan = document.createElement("span");
      labelSpan.className = "screen-marker-label tweet-hit";
      labelSpan.textContent = label;
      labelSpan.style.opacity = labelOpacity.toFixed(2);
      root.appendChild(labelSpan);

      const onSelect = function () {
        selectMarker(marker);
      };
      root.addEventListener("click", onSelect);
      root.addEventListener("touchstart", onSelect, { passive: true });
      icon.addEventListener("click", onSelect);
      labelSpan.addEventListener("click", onSelect);
      markerLayer.appendChild(root);

      const marker = {
        root: root,
        icon: icon,
        label: labelSpan,
        worldPosition: worldPosition,
        ratio: ratio,
        distanceNorm: distanceNorm,
        laneOffset: laneOffset,
        clusterOffset: clusterOffset,
        screenX: null,
        screenY: null,
        iconBaseOpacity: iconOpacity,
        labelBaseOpacity: labelOpacity,
        tweetText: t.text,
        distanceMeters: String(Math.round(distance)),
      };
      markerEntities.push(marker);
    }
    updateScreenMarkers();
    const nearestText = nearestDistance !== null ? ", 最短 " + nearestDistance + "m" : "";
    const message =
      "表示 " +
      count +
      " 件（総数 " +
      allTweets.length +
      " 件" +
      nearestText +
      "）";
    setStatus(message);
    lastBuildPosition = {
      latitude: lat,
      longitude: lon,
    };
  }

  function maybeRebuildMarkers() {
    if (!currentPosition) {
      return;
    }
    if (!lastBuildPosition) {
      scheduleBuild(true);
      return;
    }

    const moved = haversineMeters(
      lastBuildPosition.latitude,
      lastBuildPosition.longitude,
      currentPosition.coords.latitude,
      currentPosition.coords.longitude
    );
    if (moved >= rebuildThresholdMeters) {
      scheduleBuild(false);
    }
  }

  function loadTweets() {
    return fetch(tweetDataUrl)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (json) {
        const tweets = [];
        for (let i = 0; i < json.length; i++) {
          const item = json[i];
          const coords = item && item.position && item.position.cartographicDegrees;
          if (!Array.isArray(coords) || coords.length < 2) {
            continue;
          }
          const lon = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            continue;
          }
          tweets.push({
            id: String(item.id),
            text: String(item.text || ""),
            lat: lat,
            lon: lon,
          });
        }
        allTweets = tweets;
        dataLoaded = true;
      });
  }

  function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent === "undefined") {
      return Promise.resolve();
    }
    if (typeof DeviceOrientationEvent.requestPermission !== "function") {
      return Promise.resolve();
    }
    return DeviceOrientationEvent.requestPermission().then(function (state) {
      if (state !== "granted") {
        throw new Error("方位センサー権限が拒否されました。");
      }
    });
  }

  function bindOrientationDiagnostics() {
    window.addEventListener(
      "deviceorientation",
      function (event) {
        if (typeof event.webkitCompassHeading === "number") {
          deviceHeading = event.webkitCompassHeading;
        } else if (event.absolute && typeof event.alpha === "number") {
          deviceHeading = (360 - event.alpha) % 360;
        }
        if (deviceHeading !== null && currentPosition && dataLoaded && !lastBuildPosition && markerEntities.length === 0) {
          scheduleBuild(true);
        }
      },
      true
    );
  }

  function requestCameraPermission() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      return Promise.resolve();
    }

    return navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      })
      .then(function (stream) {
        cameraStream = stream;
        cameraFeed.srcObject = stream;
        return cameraFeed.play().catch(function () {
          return Promise.resolve();
        });
      });
  }

  function startLocationPolling() {
    if (!navigator.geolocation) {
      setStatus("この端末は位置情報に対応していません。");
      return;
    }

    const pollPosition = function () {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          currentPosition = position;
          markPermissionGrantedNow();
          if (!lastBuildPosition) {
            setStatus("現在地を取得しました。ツイートを表示しています...");
          }
          maybeRebuildMarkers();
        },
        function (error) {
          setStatus("位置情報の取得に失敗: " + error.message);
        },
        {
          enableHighAccuracy: false,
          maximumAge: locationPollIntervalMs,
          timeout: 30000,
        }
      );
    };

    pollPosition();
    locationPollTimer = setInterval(pollPosition, locationPollIntervalMs);
  }

  function startAR(options) {
    const opts = options || {};
    const autoStart = !!opts.autoStart;
    if (arStarting) {
      return;
    }
    if (!isMobileOrTablet) {
      setLaunchStatus("AR版はスマートフォン・タブレット専用です。地図版をご利用ください。");
      return;
    }
    arStarting = true;
    centerPanel.classList.add("is-loading");
    setLaunchStatus("データを読み込み中...");
    startButton.disabled = true;
    startButton.style.display = "none";
    const orientationPermissionPromise = requestOrientationPermission();
    Promise.all([orientationPermissionPromise, requestCameraPermission()])
      .then(function () {
        markPermissionGrantedNow();
        setLaunchStatus("ツイートデータを読み込んでいます...");
        return loadTweets();
      })
      .then(function () {
        setLaunchStatus("位置情報を取得しています...");
        createScene();
        bindOrientationDiagnostics();
        startLocationPolling();
        startMarkerRenderLoop();
        setTimeout(function () {
          hideLaunchPanel();
        }, 450);
        setTimeout(function () {
          if (!cameraStream) {
            setStatus("カメラ映像を取得できません。Safari設定のカメラ許可を確認してください。");
          }
        }, 5000);
      })
      .catch(function (error) {
        arStarting = false;
        centerPanel.classList.remove("is-loading");
        if (autoStart) {
          setLaunchStatus("自動開始できませんでした。開始ボタンを押してください。(" + error.message + ")");
        } else {
          setLaunchStatus("開始できませんでした: " + error.message);
        }
        startButton.disabled = false;
        startButton.textContent = "開始";
        startButton.style.display = "inline-flex";
      });
  }

  window.addEventListener("pagehide", function () {
    if (buildTimer !== null) {
      clearTimeout(buildTimer);
      buildTimer = null;
    }
    if (locationPollTimer !== null) {
      clearInterval(locationPollTimer);
      locationPollTimer = null;
    }
    if (markerRenderFrame !== null) {
      cancelAnimationFrame(markerRenderFrame);
      markerRenderFrame = null;
    }
    if (!cameraStream) {
      return;
    }
    const tracks = cameraStream.getTracks ? cameraStream.getTracks() : [];
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].stop();
    }
    cameraStream = null;
  });

  if (!isMobileOrTablet) {
    setLaunchStatus("AR版はスマートフォン・タブレット専用です。\n右上のMAPから地図版へ戻れます。");
    startButton.disabled = true;
  } else {
    setLaunchStatus("カメラ・位置情報の権限状態を確認しています...");
    getPermissionSnapshot().then(function (snapshot) {
      if (!shouldAutoStartFromPermissions(snapshot)) {
        const geoState = snapshot.geolocation || "unknown";
        const camState = snapshot.camera || "unknown";
        if (geoState === "denied" || camState === "denied") {
          setLaunchStatus("ブラウザ設定でカメラ・位置情報の許可を有効にしてください。");
        } else {
          setLaunchStatus("カメラ・位置情報を許可してください");
        }
        return;
      }
      setLaunchStatus("前回の許可設定を利用して自動開始しています...");
      startAR({ autoStart: true });
    });
  }
  startButton.addEventListener("click", function () {
    startAR({ autoStart: false });
  });
})();
